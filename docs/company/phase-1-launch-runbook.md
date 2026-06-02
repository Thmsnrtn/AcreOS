# Phase 1 Launch Runbook

**Trigger:** $200 MRR sustained for 30 days.
**Author:** Solene (COO) · **Last updated:** 2026-06-02

When MRR crosses $200 and holds for 30 days, this runbook activates. The charter (`acreos_company_charter.md` Phase 1 section) names *what* happens; this runbook is *how* and *in what order*, with owners + dependencies.

Solene reads this on the day of trigger and starts executing. Tom is in the loop only for the items his hands-required signature lines below explicitly call out.

---

## The critical path (must complete in order)

These four items form a hard chain — each one is a prerequisite of the next.

### 1. LLC formation — Tom-required signature
- **Service:** Northwest Registered Agent (~$39 setup + state filing fee; Wyoming or Tennessee depending on Tom's residence — Tennessee at current Tom-residence per founder context)
- **Wait time:** Most states approve within 5-10 business days. Tennessee specifically: ~3-5 business days.
- **Tom's hands:** Sign the formation documents, provide personal address for the public registered-agent record (Northwest's registered-agent service replaces Tom's home address on the public filing — pay for this, it's ~$25/yr extra and worth every penny per the [[user-work-environment]] privacy concern).
- **Output:** Articles of Organization filed; certificate of formation received.
- **Solene action on receipt:** save the certificate PDF to `/docs/legal/llc-formation/` and note the LLC's effective date.

### 2. EIN application — Tom-required signature
- **Path:** IRS Form SS-4 online — free, instant for single-member LLC.
- **Prerequisite:** LLC certificate from step 1 (the IRS application asks for it).
- **Tom's hands:** ~10 minutes at https://www.irs.gov/businesses/small-businesses-self-employed/apply-for-an-employer-identification-number-ein-online. Solene drafts the answers; Tom enters them.
- **Output:** EIN issued same-day. PDF saved to `/docs/legal/ein/`.

### 3. Banking — Tom-required identity verification
- **Service:** Mercury (per the original founder discussion). Sole-proprietor was the prior question; with LLC + EIN in hand, the proper LLC business account opens cleanly.
- **Prerequisites:** LLC certificate + EIN + Tom's personal ID.
- **Tom's hands:** Mercury's KYC flow — government ID upload, beneficial-ownership disclosure (Tom is 100%), business-address proof.
- **Output:** Mercury account live. Routing + account number captured.
- **Solene action on opening:** wire the Mercury routing/account into Fly secrets (`MERCURY_*` env vars TBD when Iris ships the integration); set up the daily reconciliation cron.

### 4. Stripe LLC migration — Tom-required identity verification
- **Path:** Existing Stripe account (under Tom's personal identity if it's already taken paid signups) gets re-keyed to the LLC. If Stripe isn't yet active, create it fresh under the LLC.
- **Prerequisites:** All three above.
- **Tom's hands:** Stripe re-verification with LLC documents (~5 minutes).
- **Output:** Stripe payouts now route to Mercury LLC account, not Tom's personal account. The founder-firewall constitution requirement (Immutable #9) is satisfied at the rails level.

---

## Parallel work (starts as soon as trigger fires; doesn't block critical path)

These run alongside the critical path. Solene dispatches them on Day 1 of trigger.

### Continuity Protocol drafting — Beatrice
- Durable power of attorney for Tom's spouse (per founder activation choice 2026-05-31).
- Includes Pause-AcreOS authority (constitutional kill-switch holder secondary to Tom).
- Output: signed POA at `/docs/legal/continuity-protocol/`. Filed with the LLC operating agreement.

### Trademark filing — Beatrice + Tom (signature only)
- USPTO TEAS Standard, Class 042 (computer + scientific services) + Class 035 (advertising / business management).
- ~$350 per class government filing fee.
- ~9-12 months for full registration; "TM" usage rights effective on filing day.
- Output: filing receipt.

### CAN-SPAM postal address — Soren
- Closes [[task-154]]. The LLC's registered-agent address becomes the postal-address footer line in every outbound transactional + marketing email.
- All four outreach email bodies in `docs/marketing/outreach/*.md` immediately become send-ready (the only block on them was the LLC address — code path is wired, just needs the value).
- Output: `OUTREACH_POSTAL_ADDRESS` Fly secret set; email templates re-render with the live value.

### Maren (CPO) activation
- Per charter Phase 1 — Maren joins as Chief Product Officer.
- Solene briefs her on the current product state, persona architecture, and the Phase 1 OKR ($1k MRR within 90 days).
- Maren's day-1 deliverable: a product-strategy assessment that recommends either Option A/B/C from the [[decision-memo-146]] persona-pruning question.

### Lena (CFO/CIO) activation
- Per charter Phase 1 — Lena joins as Chief Financial Officer / Chief Information Officer.
- Solene briefs her on the capital-allocation policy + the current bootstrap budget.
- Lena's day-1 deliverable: 12-month financial model with Phase 2 / Phase 3 / Phase 4 trigger-revenue forecasts + a per-vendor cost-attribution audit.

### Insurance prep — Beatrice (filing happens at Phase 2, prep happens at Phase 1)
- Get quotes for E&O + cyber + general liability ($75-120/mo combined target per the charter).
- Vendors to quote: Hiscox (E&O), Coalition (cyber), Next Insurance (GBL).
- Don't bind yet — Phase 2 trigger ($1k MRR) is when the budget allows. Prep saves 2-3 weeks at the gate.

---

## Phase 1 closes when (all of these are true)

- [ ] LLC + EIN + Mercury + Stripe re-titled
- [ ] Continuity Protocol signed
- [ ] Trademark filing receipt in hand
- [ ] CAN-SPAM postal address live in email pipeline
- [ ] Maren shipped her product-strategy assessment + Tom made the persona-pruning call (Option A / B / C)
- [ ] Lena shipped her 12-month financial model + per-vendor cost audit
- [ ] Truth-engine instrumented across all customer-facing surfaces (already shipped — verify still 100% pass)
- [ ] Reg Z §1026.41 + §1026.36(c) scaffolding deployed (already shipped — verify migrations ran)
- [ ] First note-servicing customer can sign up without compliance gating them
- [ ] Solene posts Phase 1 → Phase 2 transition message in the morning pulse

When all 10 are checked, Phase 1 is complete and the company is at "first revenue, founder-firewalled, regulated-floor-ready" — the operating-on-revenue state. Phase 2 ($1k MRR) is the next gate.

---

## Cost expectations at Phase 1

Per the charter envelope (~$50-80/mo):
- Fly.io (existing): ~$5/mo idle, scales with traffic
- Mercury: $0/mo (free business banking)
- Northwest registered-agent recurring: ~$125/yr ≈ $11/mo
- Cloudflare: free tier
- Anthropic / OpenAI: ramps with use, $5-30/mo at Phase 1 volumes
- Substack: $0/mo
- Zernio: ~$0-6/mo at 1-2 connected accounts
- AWS SES: ~$0.10/1000 emails — under $1/mo at Phase 1 volumes
- Buffer of ~$20/mo for incidentals (DNS changes, ad-hoc legal consults via UpCounsel, etc.)

Total ~$50-60/mo at the bottom of Phase 1; rises toward $80/mo as paid acquisition experiments start.

---

## Dependencies on other open items

- [[task-201]] (Beatrice's acquired-notes predicate implementation) lands BEFORE Phase 1 if possible — it's the gate on the first note-servicing customer. If Phase 1 trigger fires first, Iris paused-and-resumed on this is the right call.
- [[task-197]] + [[task-198]] (borrower-portal Statements panel + SES notifier) similarly should land before the first note-servicing customer touches the system.
- [[decision-memo-146]] (persona pruning) becomes ACTIVE at Phase 1 trigger; Maren's first deliverable feeds the founder call.

---

— Solene
