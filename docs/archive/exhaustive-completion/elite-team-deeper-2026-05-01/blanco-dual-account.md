# Emilio & Jessamine Blanco — AcreOS user review (joint owners, husband-and-wife operation)

We're the Blancos. Emilio, 41. Jessamine, 39. Married fourteen years, two kids, San Diego. Blanco Land Holdings LLC is the two of us — there is no third partner, no silent investor, no employee. We split the work down the middle. Jessamine runs the acquisitions side: list pulls, mail, taking inbound calls, negotiating buy prices. I handle the disposition side: marketing the parcels, talking to buyers, drafting the seller-financing notes, servicing the payments after we close. We share a CPA, a checking account, a Wyoming LLC, a SEP-IRA, and the credit cards we run the business through. We file jointly. **We are not a "team." We are a marriage that is also a business.**

I'm telling you that up front because every CRM I have looked at — including AcreOS — gets this wrong in the same way. They assume one human at the top, with employees underneath. They put a single name on the billing. They make one of us the "owner" and the other a "team member." When the owner-of-record dies or files for divorce, the platform falls over because the data model never imagined two people of equal standing.

I'm going to walk through what I found in AcreOS over a weekend of poking. The summary up front: **there is no joint-owner concept, and the workarounds it forces produce specific harms — billing fragility, tax-reporting confusion, role-permission asymmetry, and a catastrophic failure mode if one of us dies or we split.** None of these is hard to fix. Most are a single afternoon of schema work plus a settings surface. The hard part is admitting the assumption.

---

## 1. Thirty-second verdict

Would we sign up today? **Tentatively yes, on the Pro tier, with eyes open about the workarounds.** The product is good enough at the daily work — list pulls, blind offers, deal pipeline, seller-finance amortization, document signing — that we can extract real value even with the joint-ownership gaps papered over. But every workaround we adopt is a piece of fragility we are taking on, and we know it.

What I will not do is run our billing through Jessamine's card while pretending I am the "team member." When something goes wrong with that arrangement — when she's hospitalized, when one of us dies, when a 1099-K shows up addressed to her SSN for income that belongs to the joint LLC — the workaround compounds into a real problem. **That is the gap I want to walk through.**

---

## 2. The five things a joint-owner couple needs — and what AcreOS actually has

### (1) A "joint primary" concept on the organization, not a workaround.

The schema today (`shared/schema.ts:15-115`) has `organizations.ownerId` as a single text field — one Replit user ID, full stop. The `team_members` table has a `role` enum where exactly one person per org should be `owner`, plus `admin`, `acquisitions`, `marketing`, `finance`, `member`. The route guard at `server/routes-organization.ts:874` is explicit: "Only the owner can change the owner's role." There is one owner. There is no second.

The workaround AcreOS pushes us toward: make Jessamine the `owner`, make me an `admin`. Done, right? **No.** Look at what `admin` actually loses versus `owner`:
- I cannot change the org owner's role (so if Jessamine ever needs to step back, she has to do it from her account, which assumes she still has access to her account).
- I am implicitly junior in every audit log entry. When Pax pings the org with "Emilio, your assistant Jessamine asked to escalate this offer" — that's a hierarchy I don't want, because there is no hierarchy.
- The Stripe customer is attached to her email. The receipt PDFs go to her inbox. The 1099-K, if Stripe issues one for our seller-financing payment intake on Connect, lands on her SSN.
- Trust-and-safety auto-actions (account lockouts, suspicious-login flows, password resets) all go to one inbox. If she's offline for a weekend and I get locked out of the joint account because of a billing card decline at 2am, I cannot resolve it from my side.

What we need: a `coOwners` relation — many-to-one with organizations — letting an org list two (or, sure, more) human owners with full equal rights. Not "admin." Not "delegated." **Equal.** A `primaryBillingContact` and a `secondaryBillingContact` on the org so receipts and tax forms route to both. A `requireBothApprovals` flag on destructive actions (subscription cancellation, ownership transfer, data export, credit purchase above $X) — opt-in, off by default, but available for couples who want both signatures on the irreversible buttons.

The schema lift: one new table (`organization_co_owners` with `organizationId, userId, role='co_owner', isPrimaryBilling, isPrimaryTax, addedAt`), backfill the existing `ownerId` rows into it, and update the four or five permission-check call sites (`isFounder` checks, `requirePermission`, the `routes-organization.ts:874` guard) to accept any co-owner, not just `ownerId`. Half a day of work. The product change is the harder part.

### (2) Billing on either card, not "the card on file."

We have three cards we run business expenses through depending on the rewards program: Jessamine's Chase Ink (5x on shipping, which matters when we mail 8,000 yellow letters a month), my Amex Business Gold (4x on advertising), and a Capital One Spark for everything else. Today, AcreOS lets us attach exactly one default payment method per Stripe customer, and `routes-billing.ts:340` shows a single `stripe/portal` flow that lets the owner manage cards through Stripe's hosted portal. The Stripe portal does support multiple cards on a customer, fine — but the AcreOS-side surface only tells us about *the* default card. Auto-top-up at `schema.ts:30-32` charges the default card. Subscription renewal charges the default card. There's no concept of "charge Jessamine's card for marketing-related actions, charge Emilio's card for everything else."

What we need:
1. **Multiple cards visible in the AcreOS billing UI**, not just the default-from-Stripe. Show all `payment_methods` attached to the customer, with labels we can edit ("Jessamine's Chase Ink — for mail," "Emilio's Amex — for ads"), and let either of us add a card without it overwriting the other's default.
2. **Per-action card routing.** When I top up credits for a list pull, I want to pick the card from a dropdown at the moment of charge. When auto-top-up fires, I want a configurable rule ("auto-top-up uses Jessamine's Chase Ink").
3. **Both of us as billing contacts on Stripe.** Stripe customers support multiple email contacts via the `email` field plus invoice settings. AcreOS today appears to put one email on the customer (the org owner's). Add Jessamine's email *and* mine, both flagged as billing contacts so receipts CC both inboxes.
4. **A "billing fallback chain" we can both edit.** AcreOS has the bones for this — `paymentAccountId` and fallback accounts are mentioned at `schema.ts:859-863` for the disbursement side. The same pattern for the inbound side (org subscription billing) would let either of our cards back the other up if one fails, without requiring an emergency phone call from a billing-suspended state.

This isn't exotic. Stripe supports all of it natively. **AcreOS just needs a billing surface that exposes it.**

### (3) Tax reporting that names both of us.

Here is the one that will bite us in February when the W-9s and 1099s come around.

Our LLC is a multi-member LLC taxed as a partnership. We file a 1065 partnership return and each take a K-1. The LLC has its own EIN. **The Stripe customer attached to AcreOS should be the LLC, with the LLC's EIN, not either of our personal SSNs.** The 1099-K Stripe issues for our Stripe Connect payment processing (we collect down payments and amortized payments through Connect at `routes-billing.ts:389-526`) should list Blanco Land Holdings LLC, EIN, our LLC mailing address.

What I see on the org settings surface today: a `companyAddress`, `companyPhone`, `companyEmail` in the `settings` JSON blob (`schema.ts:54-56`). No EIN field. No "tax classification" field (sole-prop / single-member LLC / partnership / S-corp / C-corp). No "name on Stripe customer" field. The Stripe customer is created at `routes-billing.ts:158` and `routes-billing.ts:298` from… whatever `org.name` was when the customer was first created, with the org owner's email. If we signed up before forming the LLC and named the org "Emilio Blanco" and then formed the LLC three months later, the Stripe customer is still under "Emilio Blanco" and the 1099-K comes addressed to me personally and our CPA has to do a Schedule C / partnership reconciliation that nobody wants to do.

What we need:
1. A `tax` block in org settings: `legalEntityName`, `ein`, `taxClassification`, `taxAddress`. Surfaced in Settings → Business Profile, with an explicit "this is what appears on tax forms — make sure it matches your IRS filing" warning.
2. A "sync legal entity to Stripe customer" action — one button, updates the Stripe customer's name and tax_id field via the Stripe API, regenerates the customer's billing details. So when we form the LLC mid-year, we can correct the record without calling Stripe support.
3. **Both of us on the W-9 / W-8 surface for any ACH or seller-finance payouts.** When we onboard onto Stripe Connect to take payments, the Connect onboarding asks for ownership/control — for an LLC with two 50/50 members, the answer is both of us. The current AcreOS Connect link flow at `routes-billing.ts:389` doesn't pre-fill or validate that both of us are on the Connect account's owner list. Means the Connect onboarding might list only one of us as a beneficial owner, which is wrong under FinCEN Beneficial Ownership Information reporting (effective January 2024; small business penalty $500/day for noncompliance). **AcreOS asks us to do a thing on Stripe that has tax-and-FinCEN consequences and gives us no UI to verify both of us are listed correctly.** That is a hazard.
4. **End-of-year tax export with both members named.** The K-1 prep for our CPA needs the LLC's gross revenue, fees paid to AcreOS, gross merchandise sold via Stripe Connect, etc. Today the closest surface is `/api/usage/summary` (`routes-billing.ts:45`) which is per-org and doesn't map to a 1065 line item. A "tax pack" export — gross revenue, processing fees, AcreOS subscription expenses, credits purchased, by year, formatted for a CPA — is the obvious feature that would actually save us money in February. Two days of work for somebody who's seen a 1065.

### (4) Equal-permission roles — actually equal, not "owner + admin."

Let me get specific about the inequalities the current schema imposes.

Searching the codebase for `isFounder` / `org.ownerId` checks turns up several call sites where `ownerId` is privileged over team members regardless of role. The `routes-organization.ts:874` example is the cleanest: only the owner can change the owner's role. There's also the implicit assumption in audit logs (the org owner's name appears as the org's "primary contact" everywhere), in notification routing (org-level alerts go to the owner's email, not to the team), and in some Stripe Connect flows where the Connect account is keyed to the owner's identity verification.

The cleanest version of equal-permission is: **a co-owner is, for every permission check, an owner.** The single-owner privilege should not exist — replace it with a co-owners list, where any co-owner can do anything an owner can do, except remove the *last* co-owner (which would orphan the org).

What I do *not* want is a "joint mode" toggle that shows a couple-y UI with both faces in the corner. I want the schema to support two equal owners and the UI to show whichever co-owner is signed in, with a sidebar or settings page showing "you and Jessamine both own this organization." Functional, not cute.

A specific request: in the audit log, when a co-owner takes an action, the log entry should attribute the action to the human who did it (`acted_by_user_id = jessamine_user_id`) but also note the org's co-ownership state at the time. So if there's ever a question about "who was authorized when this happened," the audit shows: "Jessamine Blanco, co-owner since 2024-03-15, took action X on parcel Y at timestamp Z. Co-owners at time of action: Jessamine Blanco, Emilio Blanco." That is the discovery-grade audit trail a future divorce attorney or estate executor will ask for.

### (5) Death and divorce — the failure modes nobody tests.

This is where the workaround approach gets dangerous, and where I want to be specific because the founder team almost certainly has not thought through it.

**Scenario A: One of us dies.** Say Jessamine dies. Under the current schema, she's the `owner` (we did the workaround), I'm the `admin`. I now need to:
- Continue running the LLC, which now belongs to her estate until probate completes (six months to two years in California).
- Get into AcreOS to run the daily work — which I can do, as admin, *until* a billing card on her account fails, because I cannot update payment methods on her account from my admin role without her credentials.
- Eventually transfer ownership to me, which requires either logging in as her (not allowed; her death certificate makes it impersonation) or asking AcreOS support to transfer ownership based on a death certificate and probate court letters.

Today, **AcreOS has no documented "deceased owner" flow.** I searched. There is no `transferOwnershipOnDeath` route. There is no UI that says "submit a death certificate to transfer ownership." There is the route at `routes-organization.ts:874` that says the *owner* must change the owner's role, which is impossible if the owner is dead. The implied path is a support ticket — and I don't trust a support ticket to handle this in a 90-day window before our subscription auto-suspends and our Stripe Connect account locks for failure-to-respond on identity reverification.

What we need:
1. **Co-ownership prevents this entirely.** If both of us are co-owners, when one dies, the other simply continues as the surviving co-owner. No transfer needed. No support ticket. No probate dependency for daily operations.
2. **A "deceased co-owner" workflow** for when the surviving co-owner is ready to remove the deceased one from the org (which they may delay during grief). Upload death certificate, brief admin review, deceased co-owner is moved to a `removed_deceased` status (their actions in the audit log are preserved with their name, but they cannot log in and they're not counted against seat limits). Their email is removed from billing notifications.
3. **Estate-executor temporary access**, in the case where the org had only one owner and that person dies. Probate-letter-gated, time-limited (90 days), read-only-plus-export. So the executor can pull the data needed for the estate's tax filings without inheriting the operating account. Nontrivial, but it's the difference between "the LLC's records are recoverable on the founder's death" and "the LLC's records are stuck in support-ticket purgatory while the estate is being administered."

**Scenario B: We get divorced.** Ramona's case — and yes, I know Ramona, we're in the same San Diego land-investor meetup, she went through this in 2023 and lost six months on the platform side because her ex-husband had been the "owner" on her CRM and the support team couldn't transfer ownership without his cooperation, which he was withholding for negotiating leverage in the divorce. **The current AcreOS schema replicates that exact failure mode.**

What we need:
1. **Co-ownership is the protection.** Two co-owners with equal rights means neither can lock the other out unilaterally. Either can keep operating. Either can export data. Either can change billing.
2. **A "co-owner dispute" workflow** for when co-owners want to split. This is delicate because AcreOS shouldn't take sides — but it should provide tooling. Specifically: a "freeze irreversible actions" mode either co-owner can invoke (subscription cancellation, mass data deletion, exports above some volume) which then requires both signatures to lift. Time-limited (60 days). During the freeze, daily operations continue normally. This protects the asset value of the org while the humans figure out their split.
3. **A "split into two organizations" surface** for when the divorce is final and the parcels are being divided. Today, the only path is: one of you exports the data, the other starts a fresh org, you manually re-enter half the parcels. With seller-financing notes, recurring payment schedules, document attachments, contact histories — that's a multi-week reconstruction job. A real "fork organization" tool that lets co-owners select which parcels go to which side, splits the data, preserves the contact and payment histories on both sides — that's a feature that earns lifetime loyalty from divorced founders, which is more of us than the founder team probably realizes.
4. **Default to "both signatures required" for ownership transfer.** Today (`routes-organization.ts:874`) only the owner can change the owner. In a co-owner model, transferring full ownership *out* of one of the co-owners (i.e., removing them from the org) should require either their consent or a documented legal event (death cert, divorce decree). Otherwise one co-owner can remove the other unilaterally — which is exactly the failure mode that tanked Ramona's case, just inverted.

This is the section where most CRMs fail their joint-owner customers, because the founder team is usually a single founder or a venture team and "what happens in divorce" is not on their roadmap. **It needs to be.** Twelve percent of small businesses are husband-and-wife operations (Census 2022, "Self-Employed in the United States"), and the divorce rate among that population is not zero. Ramona's story is not a one-off.

---

## 3. The data-model gap, in plain words

The current schema's assumption is: one organization, one owner, one billing card, one tax identity, one inbox. Every joint-owner couple has to deform that into the workaround shape (owner + admin, single card with manual reconciliation, one of us on the tax forms, one inbox per AcreOS notification).

The real shape: one organization, two-or-more co-owners with equal rights, multiple cards with per-action routing, an LLC tax identity separate from any human's SSN, and notification routing that respects the multi-human reality. **None of this is technically hard. All of it requires the founder team to stop modeling the customer as a single individual.**

The lift: one new table (`organization_co_owners`), one extended `tax` block in org settings, multi-card billing UI, dual-recipient notification routing, and four workflows (deceased co-owner, divorce freeze, split-org, ownership-transfer-with-consent). I'd estimate three engineering weeks for the schema and core flows, plus another two weeks for the divorce/death surfaces (which need careful UX design and probably a lawyer's review). Five weeks total. **In return: you stop losing every husband-and-wife operation that hits the dual-primary wall and goes to a competitor.**

---

## 4. The day-in-the-life test — where AcreOS would slot in

A normal Tuesday at our house.

**6:00am.** Jessamine pulls a list of out-of-state owners in three Texas counties for our June mail drop. AcreOS list-pull works fine, deducts credits from the org. *Today: works.*

**8:30am.** I'm reviewing offers on parcels we mailed in February. AcreOS deal pipeline works fine, I update statuses, draft seller-finance term sheets. *Today: works.*

**10:00am.** Auto-top-up fires because we burned through credits on the morning list pull. It charges Jessamine's Chase Ink, the default card. *Today: works, but I have no per-card visibility — I would prefer this charge route to my Amex Business Gold because mail spend is on Jessamine's side and credits today are mostly for Pax's research, which is on my side.*

**11:30am.** Jessamine takes a call from a seller, negotiates a price, updates the lead in AcreOS, sends a contract for signature. AcreOS document e-sign works fine. *Today: works.*

**2:00pm.** A Stripe Connect transfer hits — a buyer paid us $4,200 on a seller-financed note. **Today: the Connect dashboard shows our LLC name only because we manually corrected it after onboarding; the auto-onboarded record had Emilio's name on it because he was the org owner. The 1099-K next year will be correct only because we caught it. AcreOS gave us no warning that the Connect account name should match the LLC's legal name.** Hazard.

**4:00pm.** Quarterly partnership tax estimate is due in two weeks. CPA emails asking for a P&L by category for Q1. **Today: I export the AcreOS usage summary and manually reconcile against our QuickBooks. AcreOS doesn't categorize spending in a 1065-friendly way, doesn't surface a "tax pack" view, and doesn't export both of our K-1 contributions in a usable format.** Workaround.

**8:00pm.** A subscription-renewal email arrives at Jessamine's inbox confirming the monthly Pro charge. I never see it because the receipt only goes to her. **Today: minor annoyance; major if it ever bounces and I don't know.** Workaround.

**Saturday morning.** We sit down for our weekly business meeting. We want to see, side by side: who took what actions, which parcels each of us advanced, what credits got spent on what. **Today: AcreOS has team analytics surfaces (`/team-dashboard`, `/team-leaderboard`, `/team-kpi`) — I'd actually use these, except they're framed as competitive leaderboards (urgency UI again) rather than as "Saturday-morning shared review."** A "co-owner shared review" surface — by-action breakdown, by-parcel contribution, by-category spend, no leaderboard framing — would be the single most-loved feature in our weekly routine. Two days of UX work on existing data.

---

## 5. Per-surface friction (for the surfaces a joint-owner couple touches)

**`/settings/billing`** — Single default card visible. Single billing email. Single tax address. No EIN field. No legal-entity name field separate from org name. Highest-priority surface to fix; the tax and 1099 path runs through here.

**`/settings/team`** — Lets us add team members with roles (owner, admin, etc.) but no co-owner concept. The "owner" badge is a status symbol that, in our case, is misleading — there is no senior partner, but the UI says there is.

**`/settings/profile`** — Per-user. Fine. But the org-level concept of "two of us are equal" doesn't appear anywhere on the org-settings side, only on the user-settings side. Wrong scope.

**`/billing/portal`** — Drops to Stripe's hosted portal, which actually does most of what we need (multiple cards, multiple billing contacts) — but AcreOS surfaces the *default* card only, so the multi-card story breaks at the AcreOS-UI boundary.

**Audit log surfaces** — Show actor (good). Don't show "co-ownership state at time of action" (because the concept doesn't exist). Adequate today; would need extension under co-ownership.

**`/team-dashboard`, `/team-leaderboard`, `/team-kpi`** — Built for an employer-employee hierarchy. We don't need a leaderboard between the two of us. We need a shared-review surface. Reframe required, not new code.

**Notifications (org-level)** — Route to one inbox (the owner's). Should support a co-owner CC list with per-notification-category opt-in/out per co-owner. Easy schema, harder UX.

**Stripe Connect onboarding** — Pre-fills with one human's details. Doesn't validate FinCEN Beneficial Ownership compliance for multi-member LLCs. **Hazard surface.** Needs a "this Connect account represents an LLC with two or more beneficial owners — list them all" affirmation.

**Data export** — Single-button export per org. Fine for daily backup. Unworkable for the divorce-fork case described in section 2.5. Needs a "fork export" mode that respects parcel-level ownership intentions during a split.

**Onboarding wizard (`onboarding-v2`)** — `businessType` enum has no "joint operation" or "spousal partnership" flag. The onboarding asks for one human's details. **The very first place AcreOS could ask "is this a sole operation or a joint operation?" and adapt the entire schema accordingly. It doesn't.** This is the upstream root of every friction below.

---

## 6. Three things AcreOS has built that we'd actually use, even before the joint-owner work lands

1. **The deal pipeline and document-versioning surfaces.** Both work fine in our workaround mode and we'd happily run our daily operations on them. The friction is around them, not in them.
2. **Stripe Connect for collecting seller-financing payments.** The infrastructure is good. Just needs the LLC-name and beneficial-owner correction surface so we don't end up with an incorrect 1099-K.
3. **The audit log.** Already records actor and timestamp on most actions. Extending it to record co-ownership state is additive, not a rewrite. Good bones.

---

## 7. The deal-killer

**There is no deal-killer.** The product works for us in workaround mode, and the workaround is tolerable for daily operations. What there is, instead, is a **slow-motion liability** that compounds over time: every month we run as "Jessamine-owner / Emilio-admin" is another month of audit logs, billing receipts, and Stripe records that name only one of us, and that we'll eventually have to reconcile in a tax filing or, worse, in an estate or divorce proceeding.

The minimum viable version of "AcreOS supports joint owners":

1. A `coOwners` relation on organizations, with a UI to invite a co-owner and a backfill that lets existing single-owner orgs upgrade to joint ownership.
2. EIN, legal-entity-name, and tax-classification fields on the org, surfaced in onboarding and in settings, with a "sync to Stripe customer" action.
3. Multi-card billing UI showing all attached payment methods, with per-card labels and per-action routing.
4. Dual billing-contact emails on the Stripe customer and on AcreOS notifications.
5. A documented deceased-co-owner workflow and a documented divorce-freeze workflow, both surfaced in Settings → Account → Major Life Events (or some non-euphemistic equivalent).

That alone — five items, maybe three engineering weeks — would move the product from "single-owner with a workaround" to "honestly supports joint owners." The fork-org tool, the FinCEN beneficial-owner verification, the tax-pack export — those are the version 2.

One last thing. If you build this, please don't market it as "perfect for couples!" with stock photography of a man and a woman shaking hands over a laptop. Build the schema, ship the surfaces, document the death-and-divorce workflows in plain language, and let practitioners find it through the trade press we read. **Most husband-and-wife land operations have been burned by a CRM that assumed one of them was junior. Tell us, quietly, that yours doesn't, and we will switch.**

— Emilio & Jessamine Blanco
   Blanco Land Holdings LLC
   San Diego, CA
