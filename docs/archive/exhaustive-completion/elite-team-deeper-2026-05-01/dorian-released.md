# Dorian Caldwell — Released, Rebuilding, Locked Out

**Auditor:** Dorian Caldwell, 41, Detroit MI
**Status:** 8 months post-release. Federal white-collar (wire fraud, 4 years served). On supervised release through 2028.
**Lens:** KYC/OFAC false-positives, banking-partner reality, probation reporting, no-credit/bad-credit accommodations.
**Date:** 2026-05-01

---

## Who I am, briefly

I did real time. I'm not asking AcreOS to forgive that — I'm asking it to not pretend I don't exist. I have $42K saved from prison wages plus a sister's loan, a clean 8-month track record, an LLC my PO approved, and three banks that already told me no. Land investing was my plan before I went in. It's still my plan. I need software that lets a man with a record build a legitimate business without having to lie about who he is to get past the front door.

What I'm watching AcreOS for: where does the product silently assume I'm a clean-credit, clean-background, instantly-bankable customer — and what breaks when I'm not.

---

## The five places I get stopped

### 1. KYC false-positives at signup

Background checks come back "review" or "fail" on me roughly 30% of the time even when nothing's wrong, because of the felony record plus a name overlap with a guy in Ohio. Most products either (a) hard-block me, or (b) silently shadow-ban — let me sign up but throttle features I never see mentioned.

What I need from AcreOS:
- An explicit **status surface** when KYC returns adverse. Not a generic "we'll be in touch." Tell me: what flagged, who flagged it, what the appeal path is, and what I can use **right now** while it resolves.
- A **manual review queue** with SLA. 5 business days max. Founder-tier escalation if the automated provider returns a false positive on identity-only checks.
- **Provider transparency.** If Persona or Alloy or whoever flagged me, I want to know which one — because I've already disputed with them directly and have records. Letting me attach a prior dispute resolution should short-circuit re-review.
- Do **not** use credit-bureau identity proofing as the only path. Knowledge-based authentication asks me about addresses from 2019 — I was incarcerated. I literally cannot answer. Offer document-based identity (ID + selfie + utility bill) as a first-class path, not a fallback.

### 2. OFAC / sanctions screening false-positives

My legal name is close enough to a sanctioned individual that I get an OFAC hit on roughly half of new financial signups. It is wrong every time. It also takes 3-10 business days to clear, during which I am locked out.

What AcreOS should do:
- Run OFAC fuzzy-match with a **confidence threshold** and a tiered response. High-confidence hit: block + manual review. Low-confidence fuzzy hit: allow read-only access and a clear "we're verifying" banner — do not pretend the product is fully working while back-end is gated.
- **Cache the cleared-OFAC result** for 12 months on my account. I should not get re-flagged every time I add a new payment method or escrow partner. The cleared status should propagate to downstream banking partners via the integration layer, not force me to re-clear with each one.
- Surface the **actual OFAC list date** that matched. The lists update weekly. If my last check was 11 months ago I want to know that, not be surprised.

### 3. Banking partner brittleness

Here's what nobody talks about: AcreOS doesn't bank me — it routes me to a bank or BaaS partner. And those partners are the actual gatekeepers. Today I am declined by Mercury (no reason given), Relay (no reason given), and Bluevine (cited "risk profile"). I'm currently on a community bank in Detroit that took 6 weeks to approve and required in-person meetings.

What AcreOS needs to acknowledge:
- **Multi-partner routing.** Don't lock me into one banking partner. If Partner A declines, route the application to Partner B with my consent, and tell me you're doing it. The current "one partner, take it or leave it" model is the single biggest reason second-chance founders give up.
- **A "partner-agnostic" mode.** Let me bring my own bank. I'll connect via Plaid or manual ACH. The product should not degrade — escrow, payouts, reporting should all still work — just with an external bank attached.
- **Pre-flight bank eligibility check.** Before I fill out a 30-minute application, tell me which partners are likely to approve given a soft signal (e.g. "Partner A typically declines applicants with felony records in the past 7 years; Partner B and C do not have this restriction"). Don't pretend the discrimination doesn't exist — surface it so I can self-route.
- **Decline reasons, even truncated.** A "your bank application was not approved" with no reason and no human is the worst experience in fintech. Even a category ("background", "documentation", "address verification") helps me move on.

### 4. Probation officer reporting

This is the one thing I've **never** seen accommodated. I have to report to my PO monthly. He needs:
- Source and amount of all income
- Bank statements
- Business activity summary (parcels acquired, contracts signed, revenue)
- Tax filings as soon as available
- Notification of any out-of-state travel I do for the business

What AcreOS could trivially do:
- A **"Compliance Officer Report"** export — PDF, monthly, covering income, transactions over a threshold, parcels touched, business activity narrative. Make it as easy as exporting a tax summary.
- **Read-only access for a third party** with scoped permissions. My PO doesn't need to log in as me — but if I could grant him a view-only link with an expiration, that'd save me 2 hours of manual reporting every month.
- **Travel/jurisdiction tagging on parcels.** I have to get permission to travel out of state. If the parcel detail page surfaces "this parcel is in TX (out of your supervision district)" with a notification flag, that's a feature for me and zero overhead for everyone else.
- This is **not a niche feature for felons.** It's also useful for: bonded contractors, fiduciary trustees, regulated agents, anyone with reporting obligations. Build it for me, ship it for everyone.

### 5. No-credit / thin-credit accommodations

I have no FICO. The bureaus think I'm dead — four years of zero activity tanked everything. Anything in AcreOS that uses credit as a signal silently excludes me:
- Tier eligibility
- Escrow limits
- Net-30 vendor terms
- Payment-method options
- Automatic increases on transaction caps

What I'd want:
- **Cash-flow-based limits.** Look at 90 days of bank activity through the AcreOS account. If I'm running clean, raise my limits. Don't make me wait 12 months for a credit score I'll never have.
- **Manual underwriting path.** Let me submit references, prior business activity, attorney attestation, anything. The 30-second auto-decline because "credit not found" is the second most discouraging experience in fintech (after the no-reason banking decline).
- **Disclose what's gated by credit.** If I can't use feature X because of credit, tell me up front in the feature description, not after I've configured a deal and clicked "send."

---

## What this looks like inside the product

A few specific surfaces I'd audit:

- **Onboarding wizard** (`components/onboarding/OnboardingWizard.tsx` per the persona architecture note): Today, does the KYC step have an "adverse result" branch with appeal copy? Or does it dead-end with a generic error? The branch needs first-class design treatment, not an afterthought.
- **Org settings → banking**: Can I disconnect a partner and reconnect through a different one without losing transaction history? If not, that's a one-way door I'd never walk through.
- **Compliance section** (does it exist?): A dedicated tab for export bundles, audit logs, and third-party access tokens would solve PO reporting and also serve registered agents, accountants, and lawyers.
- **Provider registry** (`server/services/providers/`): Is there a category for KYC and OFAC providers with the same circuit-breaking and tier-filtering as everything else? If so, the provider transparency I'm asking for is a UI exposure of data the registry already has — small lift.
- **Error responses** for KYC/OFAC routes: per `Errors.*` standard, these should return structured details, not opaque 403s. I want the `details` field populated with provider, reason category, and appeal URL.

---

## Things AcreOS might be tempted to do that would be wrong

1. **Quietly downgrade me to a "limited" tier without telling me.** This is the worst pattern. I'd rather be told "no, here's why" than be soft-locked in a product that pretends I have full access.
2. **Treat second-chance accommodation as a separate "compliance product."** It's not. The features I need (alternate identity verification, bank routing, compliance exports, cash-flow underwriting) are useful to far more than ex-offenders. Building them general-purpose is cheaper and serves more people.
3. **Marketing the second-chance angle.** Don't. We don't want to be a charity case. We want a product that doesn't filter us out at the door. Quiet competence beats loud inclusion every time.
4. **Requiring a credit pull as part of onboarding.** A credit pull does two harmful things: it dings my score (which I'm trying to rebuild), and it gates entry. Soft-pull only, and only when actually needed for a specific feature.

---

## Severity ranking

| # | Issue | Customer impact | Likely product gap |
|---|---|---|---|
| 1 | OFAC false-positive lockout with no transparency | Critical — total exclusion | High |
| 2 | Single banking partner, no fallback | Critical — total exclusion | High |
| 3 | KYC adverse-result UX dead-ends | High — silent abandonment | Medium-High |
| 4 | No PO/compliance export tooling | Medium — manual workaround | High (greenfield) |
| 5 | Credit-gated features without disclosure | Medium — hidden exclusion | Medium |
| 6 | KBA-only identity verification | High — locks out the incarcerated, recently-immigrated, address-unstable | Unknown |
| 7 | No partner-agnostic / BYO-bank mode | Medium — limits resilience | High |

---

## What I'd build first

If I had one sprint:
1. Adverse-KYC and OFAC-flagged status pages with appeal flow, provider attribution, and 5-day SLA. (1-2 weeks)
2. Compliance export bundle (PDF + CSV monthly). (1 week)
3. Banking partner pre-flight eligibility surface. (1 week)

That's a month of focused work and it converts a meaningful share of customers who currently bounce silently — not just second-chance founders, but anyone with a non-standard profile.

---

## Specific scenarios I want AcreOS to survive

**Scenario A — "Stuck at signup."** I create an account. KYC returns "manual review." Today the product probably parks me in a frozen state. What I need: a `pending_kyc` org status that lets me explore, build my watchlist, draft offers (held in escrow-pending), invite a partner — anything that does not move money or commit me legally. Convert me when the review clears. Don't waste the 5 days.

**Scenario B — "Bank dropped me."** Six months in, my partner bank closes my account (it happens — they re-evaluate annually and a felony record can trigger off-cycle review). Today: probably catastrophic data + workflow loss. What I need: a transition mode where pending payouts get held in escrow, not bounced; ACH credentials swap is a guided flow not a re-onboarding; transaction history persists across the partner change.

**Scenario C — "PO surprise audit."** My PO calls Tuesday and wants a YTD report by Friday. Today: I'm exporting CSVs and stitching them in a spreadsheet at 11 PM. What I need: one button, one PDF, with everything he's ever asked for laid out in the order he asks for it. Save the template after the first time.

**Scenario D — "Travel for closing."** I have a parcel under contract in Tennessee. I need PO sign-off to drive there. Today: I tell him verbally, hope he writes it down, hope I don't get violated for an unreported trip. What I need: a parcel-detail action that generates a travel-request form pre-filled with parcel address, expected dates, business purpose, return date. Email it to him; log it on the parcel record.

---

## Underwriting questions I want AcreOS's team to actually answer

1. What is the documented appeal path when a KYC provider returns adverse? Who reviews? What's the SLA?
2. Is there an OFAC fuzzy-match threshold, and is it tunable per tier?
3. How many banking partners are integrated? Can a customer be re-routed if Partner A declines?
4. Is there any feature gated on a hard credit pull rather than a soft pull or cash-flow signal?
5. Does the product have an audit-log / compliance export that a non-user can be granted scoped access to?
6. What happens to a customer's data when their partner bank closes their account?
7. Are there documented metrics on KYC pass rate, broken out by demographic or risk segment? (If not — start measuring. You can't fix what you don't see.)

If the team can answer these crisply, the product is in much better shape than I'd guess. If the answers are "we'd have to check" — that's the audit finding.

---

## Closing

I'm not the customer AcreOS is designing for today. I know that. But I am — statistically — a real customer. Roughly 1 in 3 American adults has a criminal record. A non-trivial fraction of them are working to build legitimate small businesses, including in land. The product that figures out how to onboard us cleanly, without spectacle, wins a market everyone else has written off.

The fixes are not charity. They are operational hygiene that happens to also work for the underwritten edge case. Build them once, ship them quietly, and let the rest of us get to work.

I am a good customer. I pay on time. I read the docs. I file my taxes early because I have to. I do not commingle funds because my freedom depends on it. I will be the cleanest user on your platform — if you let me on.

— Dorian Caldwell
