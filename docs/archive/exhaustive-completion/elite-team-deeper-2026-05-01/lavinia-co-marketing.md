# AcreOS — Co-Marketing Partner Audit

**Reviewer:** Lavinia Espinosa, 46
**Role:** Growth Lead — adjacent-product (hard-money lender CRM / RE-investor tax-prep stack; the kind of vendor that sits one step before or after AcreOS in the Land Investor's quarter)
**Date:** 2026-05-01
**Audit wave:** 3 — co-marketing partner lens
**Engagement context:** AcreOS approached us for a Q3 co-marketing arrangement — joint webinar, two-way list swap, and one piece of integrated content. This memo is what I'm going to send to my CMO before we sign anything.

---

## 1. Why I'm taking the meeting at all

AcreOS shows up on three of my growth team's competitive scans this quarter and the founder (Thomas Norton) is hands-on enough to actually return Slack DMs in under an hour. That alone moves them above 80% of would-be partners we get pitched. The product is a "Land Investors" workflow stack — deal feed, due diligence across ~18 data providers, mailing campaigns, seller-financed note management, compliance gating. Our customer base sits adjacent: people who are about to buy, just bought, or just sold land and now have a tax/lending event. The overlap is real. So I'm taking it seriously, not as a favor.

What follows is what I would bring to a partnership review committee — not a love letter.

---

## 2. Brand fit

**Verdict:** Strong on tone, weak on visible legitimacy markers, mixed on positioning consistency.

**What works for me:**
- The "Land Investors" framing is sharp and consistent. It's a real persona, not a TAM-inflating euphemism for "anyone in real estate." We can co-market into the same audience without having to renegotiate language every campaign.
- The native e-sign posture (their own signing stack rather than reselling DocuSign) reads as serious infrastructure investment. That's the kind of signal a partner CMO trusts — they're building, not duct-taping.
- The persona architecture (customers see one assistant; founder-side surfaces have their own internal cast) means I'm never going to get a confusing co-marketing brief that mixes a customer-facing AI with internal tooling. Clean.

**What I'd flag in committee:**
- No visible logo wall, no published customer roster, no case-study page. I went looking. `content/marketing/` has `pricing-faq.md` and `referral-copy.md` and not much else. For a co-marketing pitch where I'm putting my list in front of their brand, I need at least three named customers and one quantified outcome. Today I have zero.
- The landing page (`acreos-landing/`) has multiple section files (`sections-1.jsx`, `sections-2.jsx`, `sections-3.jsx`) but no obvious "press / partners / trusted by" surface in the copy I sampled. The brand reads "competent solo-founder" not "category leader." Co-marketing usually wants the latter — or wants to *manufacture* the latter, which is fine, but it's a conversation we need to have explicitly.
- The repo also contains a `sovereign-protocol/` folder and references to "AcreOS Valuation," "Adaptive Strategy V13," "Agent Negotiation V11," etc. Lots of internal version numbers leaking into surface area. If any of that vocabulary makes it into co-branded material it will read as half-baked. We'll need a copy guardrail.

**Brand-fit score: 6.5 / 10.** I'd partner, but I'd want to lead the joint creative direction and gate every piece through my comms team.

---

## 3. Audience overlap

**Verdict:** Genuinely complementary, not cannibalistic. This is the strongest part of the case.

**Where we overlap:**
- Land Investors who flip parcels need (a) due-diligence on the parcel — AcreOS, (b) capital to close — my product if we're a lender CRM, (c) tax treatment on the gain — my product if we're tax-prep.
- AcreOS' direct-mail attribution surface (`migrations/0014_direct_mail_attribution_and_api_keys.sql` introduces `tracking_code` on mailing pieces and `source_mail_piece_id` on leads) means they have UTM-grade attribution on offline campaigns. If my list responds to a co-branded mailer, we will both be able to see who actually closed. That's rare and it's the basis for any honest revenue-share.

**Where we don't overlap, and that's good:**
- AcreOS does not appear to be building lending or tax-prep into their stack. Provider registry (`server/services/providers/`) is data-vendor oriented (skip-trace, address verification, valuations) — not capital or accounting. So a co-marketing partnership is additive on both sides, not a stalking-horse for them building what we sell.

**Estimated overlap:** Of my ~14k active accounts, I'd guess 18–28% are active or aspiring Land Investors. Of AcreOS' base — and I don't know the size, which is itself a flag — a meaningfully higher share will need our product within 90 days of closing. The asymmetry actually favors AcreOS as the *receiver* of our list more than the giver. We need to talk about that.

---

## 4. Integration story

**Verdict:** Plumbing exists, narrative does not. If we co-market, we are co-marketing a *product roadmap*, not a *shipping integration*.

**What's actually built:**
- `server/webhookHandlers.ts` and `server/services/webhookDispatcher.ts` — outbound webhook infrastructure exists.
- `migrations/0014_…api_keys.sql` — `org_api_keys` table with `key_hash`, `key_prefix`, `scope`, `expires_at`, `is_revoked`. So per-org API key issuance is in the schema. Foundation.
- `server/routes-import-export.ts` and `server/services/importExport.ts` — bulk in/out flows exist.

**What is *not* built (or not visibly):**
- A public API reference. I searched. No `docs/api/`, no OpenAPI surface I could find. For a co-marketed integration I need something an engineer can read in 20 minutes.
- Webhook event catalog. Outbound dispatcher exists; documented event types (e.g., `lead.created`, `parcel.closed`, `note.signed`) do not appear to be published.
- OAuth or partner-app onboarding. The keys table is per-org self-issued. There's no "Connect AcreOS" button I can put in my product.

**Implication for the joint webinar:** We cannot honestly demo a live integration in Q3. We *can* honestly demo a side-by-side workflow ("close the parcel in AcreOS → export → upload to us") and announce a roadmap to webhook-driven handoff in Q4. That's a fine story but it has to be framed correctly. If marketing oversells "integrated," engineering on either side will hate us.

---

## 5. Joint webinar economics

**Verdict:** Worth doing once. Build the model with eyes open.

**Cost model (my best estimate, our standard rates):**
- Production: $4–6k (platform, design, host fees if external, post-edit).
- Promo budget split 50/50: $8–12k each.
- Internal time: ~80 person-hours across both companies.
- All-in per side: roughly **$12–18k**.

**Realistic registration funnel for a niche B2B Land Investor topic:**
- Combined promo reach: my 14k + AcreOS list (unknown — call it 6–10k informed guess from a single-founder ARR-stage company) = ~22k unique.
- Registration rate 4–7% → 880–1,540 registrants.
- Show rate 35–45% → 308–693 live.
- Replay views over 30 days roughly equal to live, so 600–1,400 total engaged.

**Pipeline math (my side):**
- Qualified-lead rate from this audience: ~12%.
- Opportunity rate: ~3%.
- ACV in our segment: ~$1,800/yr.
- Expected booked ARR over 90 days: $16k–$45k.

That's break-even to 2.5×. Not a slam dunk, but reasonable for a Q3 brand play. **The real value is the asset, not the live event** — replay + clipped social + a co-branded post-event report. We should structure the budget assuming the live event is the *minor* line item.

**Ask for AcreOS:** commit to producing one quantified case study (one customer, one number — "X parcels closed in Y days") as the webinar's anchor narrative. Without that, we're hosting a vibes event.

---

## 6. List-swap mechanics + DMA / privacy compliance

**Verdict:** Do *not* do a raw list swap. Run it as a co-registration with affirmative consent. AcreOS is set up reasonably for this; we still need a written DPA.

**What I checked on their side:**
- `server/routes-gdpr.ts` exists — they have GDPR endpoints (presumably export/delete). Good.
- `server/middleware/complianceGate.ts` — there's a runtime gate, suggesting they take compliance posture seriously rather than as a checkbox.
- `docs/data-privacy.md` exists in the repo — there's a written privacy policy artifact, which I'd want to read in full before any swap.
- `server/services/sophiePrivacyGuard.ts` — they have a named privacy-guard service in their AI tier. Encouraging, though I'd want to know what it actually enforces.
- `server/services/campaignOverlapDetector.ts` — they detect when their own campaigns might overlap. That's a sophistication signal that suggests their team will understand suppression-list mechanics.

**What I want before any list activity:**
1. **Signed mutual DPA** covering controller-to-controller transfer, purpose limitation, retention windows, and downstream-processor disclosure. Non-negotiable.
2. **Affirmative co-reg consent** — the webinar registration form must say, in plain English, "I agree to receive follow-up from both AcreOS and [Lavinia's company]." Pre-checked boxes are not acceptable in any of our regulated regions.
3. **Suppression-list exchange** — both sides must process each other's unsubscribe / opt-out requests within 48 hours. We share a suppression file fortnightly during the campaign window.
4. **CAN-SPAM / TCPA hygiene** — for the US population, no SMS without separate opt-in, and every email must carry both senders' physical addresses if co-branded.
5. **DMA / UK-EU specifics** — for any EEA registrants, separate legitimate-interest assessment, and we don't enrich beyond what they registered with. AcreOS' GDPR endpoint existence helps us argue compliance posture but does not substitute for the DPA.
6. **State privacy laws** — CCPA / CPRA notice and "Do Not Sell or Share" honoring on both sides. A list swap is a "sharing" event under CPRA; the consent has to be explicit.

**Mechanics I'd actually run:**
- Co-hosted registration page on a shared subdomain. Both logos. Single consent checkbox covering both companies. Single privacy notice linking to both policies. Registrants enter both CRMs at the moment of opt-in — there is no "swap" file ever exchanged in raw form.
- Post-event: two parallel nurture sequences (one each). No re-pollination. Track suppression bilaterally for 12 months.
- Attribution: shared registration source + cookie + UTM. Use AcreOS' `tracking_code` mechanism for any direct-mail follow-up so we can both see closes.

**Risk if we cut corners:** A single complaint to a state AG or the ICO is a six-figure problem. The "we're small, who'd notice" defense is dead.

---

## 7. Customer-overlap analytics

**Verdict:** Both sides have just enough instrumentation to do this honestly. Pick the methodology now, not in retrospect.

**What we can measure:**
- **Pre-existing overlap:** hashed-email join (SHA-256 with a shared salt published in the DPA) between my MAU and AcreOS' active orgs. I'd expect single-digit-percent overlap pre-campaign — that's the baseline.
- **Co-marketing-driven net-new:** unique registrants on the co-reg page who were not in either CRM 24 hours prior. That's the headline number for the post-mortem.
- **Cross-conversion lift:** of registrants who become AcreOS customers within 60 days, what share become my customers within 90 days, vs. a control cohort of AcreOS sign-ups with no joint-webinar exposure. AcreOS will need to give us aggregated, hashed conversion data — not row-level — for this to be DPA-clean.
- **Direct-mail-attributed closes:** their `source_mail_piece_id` on leads gives us a clean way to attribute revenue back to a co-branded mailer if we run one as the second campaign asset.

**What we cannot measure honestly without more work:**
- LTV uplift on either side. Their analytics surface (`server/services/acreOSValuation.ts` and similar) appears to be customer-facing rather than partner-facing. If we want partner LTV reporting we have to build it together.
- Multi-touch attribution across the full funnel. Neither side has a partner-attribution dashboard. We will be reconciling spreadsheets.

**Recommendation:** define the three KPIs in the partnership memo *before* launch — net-new co-reg, 60-day cross-conversion, and qualified-pipeline dollars per side — and agree no other number is "the result." I have seen too many partnerships dissolve in metric-shopping after the fact.

---

## 8. Risks

1. **Stage mismatch.** AcreOS is small enough that one busy week on their side could starve our co-marketing of attention. Founder-led companies under-deliver on partnerships ~40% of the time in my experience. Mitigation: a single named owner on each side, written-down deliverables, calendared check-ins.
2. **Brand asymmetry.** My brand is more recognizable than theirs in our shared market today. We will get more out of the swap-of-credibility than they will, which means *they* should be asking for terms, not us. If their team isn't doing that, I'd note it as a sign of growth-team immaturity and adjust expectations.
3. **Integration overpromise.** Already covered. Strict copy gate.
4. **Compliance debt.** Their GDPR endpoint and compliance-gate middleware suggest awareness, but I haven't seen their actual privacy policy text or their DSAR fulfillment SLA. Need both before signing.
5. **Internal vocabulary leakage.** Strings like "Sophie," "Forge," "Atlas," "Sovereign Protocol," "V11/V12/V13" need to be explicitly excluded from co-branded surface area. Add to copy guardrails.
6. **Founder-bus-factor.** Thomas is the visible technical and brand voice. If he's unavailable during launch week, we have no second contact. Ask for a marketing/ops counterpart by name.

---

## 9. Recommendation to my CMO

**Proceed, with three conditions.**

1. **Land one named, quantified case study from AcreOS before we lock the webinar date.** No anchor customer story = no event.
2. **Sign a mutual DPA and agree on co-reg-with-affirmative-consent** as the only list mechanic. No raw file swaps under any circumstances.
3. **Scope the integration narrative as "shared workflow today, webhook-driven handoff Q4 roadmap."** No live integration demo unless one ships in writing first.

Pilot scope: one webinar, one co-authored long-form asset (the post-event report), one direct-mail experiment using AcreOS' tracking-code attribution. 90-day review. If we hit 1.5× ROI on bookings or 800+ net-new co-reg leads, we expand to a quarterly cadence and start the integration build conversation in earnest.

If we miss both, we walk amicably and stay friendly for a future cycle. AcreOS is the kind of partner who is going to be either much bigger or visibly stuck a year from now, and either outcome is worth knowing about.

— Lavinia
