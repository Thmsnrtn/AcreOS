# Indigo Marshfield — Win-Back Campaign Audit (Deeper Wave 3)

**For:** Thomas Norton, founder, AcreOS
**Date:** 2026-05-01
**Lens:** 14 years running quarterly win-back programs at SaaS companies between 200 and 50,000 churned-customer cohorts (Mailchimp, Squarespace, Calendly, two B2B fintechs). The bias I bring: **win-back is a four-quadrant problem — segmentation × timing × in-product hooks × ethical limits — and getting any one wrong torpedoes the other three.** A churn cohort isn't a list; it's six populations with six probabilities of return, six different reasons for leaving, and six different reasons they'd come back. Ship one sequence to all of them and the 60% segment subsidizes the 5% segment until deliverability collapses for both.
**Builds on:** Konstantin (`elite-team-deep-2026-05-01/konstantin-retention.md` — `churn_reasons` taxonomy; `winback_attempts` ledger; reason-segmented sequences; re-engage subdomain) · Sigrid (`elite-team-deep-2026-05-01/sigrid-lifecycle.md` — 5-touch skeleton at T+0/2/7/30/90; `subscription.canceled` Stripe webhook trigger; landing FAQ already *promises* the T+0 email; reply-rate north-star).

---

## 1. One-line verdict

Win-back readiness: **the strategy doc is largely written across Konstantin §6 and Sigrid §3.4 — what's missing is (a) the cancellation-survey-to-segment classifier that makes targeting possible, (b) the in-product reactivation hooks that make returning frictionless, (c) a "what's new since you left" content engine fed by the changelog, and (d) the ethical-limit guardrails that prevent the win-back program from becoming the reason the active-user briefings get spam-binned** — and without those four, the 5-touch sequence collapses into a 5-touch general-purpose nag that achieves the industry-median 5-8% reactivation when the saveable segments are capable of 35-60%.

---

## 2. Win-back segmentation — beyond Konstantin's six categories

Konstantin's six-reason taxonomy (`pricing | missing_feature | wrong_fit | competitor | timing | inactive_user`) is the right categorical axis. But segmentation for win-back is two-dimensional — **reason × value-tier**. A `pricing` churn from a Solo $39/mo customer and a `pricing` churn from an Operator $299/mo customer are not the same campaign — the first wants a discount; the second wants a plan-call.

### 2.1 The 2D segmentation matrix

```
                    Solo ($39)     Operator ($299)  Land-Group ($799+)
pricing             A1: discount   A2: plan call    A3: custom-quote
missing_feature     B: ship-update flow (all tiers — content varies, treatment same)
wrong_fit           C: empathy-only (all tiers, no further sequence)
competitor          D1: differentiation D2: diff+call D3: founder direct
timing              E: data-warm + season-trigger (all tiers; offer scales)
inactive_user       F1: simplified F2: white-glove F3: dedicated CSM
```

**Rules:**
1. **Six reasons × three tiers ≠ 18 sequences** — effectively eight distinct treatments. `wrong_fit | missing_feature | timing` don't tier-flex meaningfully; `pricing | inactive_user | competitor` do.
2. **Tier-flex is who replies, not what's said.** Operator+ churners route to `thomas@acreos.io`; Solo route to Sophie-classified queue with founder escalation only on positive intent.
3. **`wrong_fit` gets one email and stops.** 5-10% reactivation × high effort = bad ROI. Single empathy email exists for brand reasons (the FAQ promise), not conversion. Suppress all subsequent touches.

### 2.2 The unstated seventh segment — `unintentional_churn`

Konstantin's six miss the largest *saveable* segment in B2B SaaS: **involuntary churn from payment failure**. Industry baseline: 20-40% of "churn" in early-stage SaaS is dunning failure dressed up as cancellation.

The `subscription.canceled` Stripe webhook fires for two distinct events — `voluntary_cancel` (user clicked) and `involuntary_cancel` (Stripe gave up after retries). Win-back must treat them differently:
- **Voluntary** → reason taxonomy applies, sequences from §3.
- **Involuntary** → smart-retry (T+0 "card declined — fix in 30s"; T+3 "still locked out"; T+7 "data goes cold in 14d"). Reactivation rate: 50-70% with well-timed dunning. **Highest-ROI single win-back lever AcreOS can build.**

`winback_attempts` needs a `cancellation_type` column; reason-classifier defaults to `involuntary_cancel` (not `inactive_user`) when no survey was completed.

---

## 3. Cancellation-survey-to-segment classification

The bottleneck for everything in §2 is **the cancellation survey actually classifying reliably.** Konstantin assumes the taxonomy gets populated; Sigrid assumes the trigger fires. Neither audits the classifier.

### 3.1 The cancellation-flow surface

Cancel routes through survey, not bypass. `/settings/billing/cancel` → `CancelFlow.tsx`:

- **Step 1 — pause-not-cancel offer.** "Would pausing for 60 days help?" 8-12% take pause; pause triggers a separate `paused_60d` ladder.
- **Step 2 — reason picker (required, single-select).** Six radios matching Konstantin's taxonomy + optional `Other`.
- **Step 3 — reason-specific deepening:** `pricing` → target price (number); `missing_feature` → which feature (text + roadmap tag autocomplete); `competitor` → which one (text — most valuable single field for win-back content); `timing` → return date (becomes T+ trigger); `inactive_user` → what got in the way (text); `wrong_fit` → no follow-up.
- **Step 4 — confirm.** All steps required; no skip. Friction is intentional — gives segmentation real data and creates a reflection moment that itself converts ~3-5%.

### 3.2 The `inactive_user` failure mode + `feature_requests` join

When survey is skipped (Stripe portal cancel), default classifier marks `inactive_user` — pollutes the segment with high-value churners. Two fixes: (1) **disable Stripe portal cancel** so all cancels go through `/settings/billing/cancel`; portal stays enabled for invoice/payment-method only. (2) **Sophie-inferred fallback** — Konstantin's `sophie_inferred` classifier looks at last-30d engagement, NPS, ticket sentiment, assigns probable reason with `confidence_score`. Confidence < 0.6 → `reason = unknown`, not `inactive_user`.

When `missing_feature` fires, text + tag writes to `feature_requests (org_id, feature_tag, churned_at, sequence_id)`. When a roadmap item ships, changelog publish queries `feature_requests WHERE feature_tag = ? AND reactivated_at IS NULL` and triggers personalized "we built what you asked for." **Single highest-converting win-back email in B2B SaaS — routinely 50-65% reactivation when the feature genuinely matches.** Effort: 0.5d schema + 0.5d publish hook.

---

## 4. Message timing — when each touch fires and why

Sigrid's T+0/2/7/30/90 cadence is reasonable default but applies the same calendar to every reason. Different reasons have different optimal cadences because the *psychological state* of the churner evolves at different rates.

### 4.1 The reason-specific cadence map

| Reason | T+0 | T+7 | T+30 | T+45 | T+90 | T+180 |
|---|---|---|---|---|---|---|
| `pricing` | empathy + capture target price | pause-not-cancel reminder | discount offer (50% off 3mo) | plan-options menu | quarterly check-in | annual "things changed?" |
| `missing_feature` | empathy + feature capture | — | ship-update IF shipped | — | generic roadmap update | — |
| `wrong_fit` | empathy only | suppress all subsequent | — | — | — | — |
| `competitor` | empathy + capture which | — | differentiation (head-to-head) | — | "have they raised prices?" | annual "still happy?" |
| `timing` | "data warm 90d" + capture return-date | — | — | season-change check | "season changed — back?" | final ping |
| `inactive_user` | "what would have made this stick?" | simplified onboarding offer | "try again — 50% off, no setup?" | suppress | suppress | annual reactivation |
| `unknown` | single empathy email | suppress | suppress | suppress | suppress | annual ping |
| `unintentional` | dunning + "fix card" | "data cold in 7d" | — | — | — | — |

### 4.2 Three timing principles + the `timing` segment

**Empathy at T+0 always, sales never at T+0.** First touch within 24h is acknowledgment, not pitch. Reply rate target: 8-12% (highest of any lifecycle send — customer just took action, is in dialogue mode). **T+30 is the conversion window** for `pricing | missing_feature | competitor` — customer has had time to live without AcreOS, feel the absence, reconsider. Earlier than T+14 = pushy; later than T+45 = forgotten. **T+90+ is brand maintenance, not reactivation.** Sigrid's `winback-t90` "delete your data" is the operational ping that doubles as final brand touch. Win-back ends at T+90; hands off to dormant-prospect newsletter (opt-in only).

The `timing` segment is highest-converting (60-70%) — customer told you when they'd return, use it. Captured `return_date` from §3.1 step 3 becomes trigger: `T+(return_date - 7d)` "your workspace is still warm"; `T+(return_date)` "your reactivation link, ready when you are"; `T+(return_date + 14d)` if no reactivation "did the timing shift?" Most effective sequence in the program because the customer self-scheduled it. 0.5d for date-relative trigger logic.

---

## 5. In-product reactivation hooks — making the return frictionless

The single most-overlooked win-back lever is **what happens when the email succeeds**. A churner clicks reactivation, lands on `/login`, has to remember password, hits MFA, gets to a dashboard that looks unchanged from when they left — and 35-50% bounce in the first 90 seconds. The sequence converted them; the in-product un-converted them.

### 5.1 One-click reactivation + the "data is warm" promise

Every win-back email's primary CTA goes to `https://acreos.io/return?token={{signed_jwt}}`. The `/return` route validates the token (signed, expires 14d, single-use), auto-logs in (no password), and if subscription is `canceled` + segment qualifies, presents one-click reactivation. On click → Stripe API restore → redirect to `/today` with banner: "Welcome back. Pax has been watching your counties — {{N}} new opportunities since you left." **No password reset. No re-onboarding. No MFA challenge** — signed token serves as second factor. 1.5d for `/return` route + token signing + Stripe restore.

The in-product hook delivers what the T+0 email promised — **leads, mailers, scans, artifacts, and Pax memory exactly as left.** No data deletion at cancel: set `organizations.archived_at`; reads gated behind `archived_at IS NULL OR within_winback_window(archived_at)`. Pax memory preserved across the gap so the first returning briefing can reference it. Hard-delete only at T+90 + 30d grace — the "deleting your data on {{date}}" message must be honest, and the window between message and delete is the final conversion lever (~3-7% of remaining segment).

### 5.2 The "while you were away" card

When returning user lands on `/today`, first surface is a card synthesizing: counties they were scanning (new opportunities, count + top three); features shipped during absence (persona-relevant changelog entries); their leads (change-of-status events — tax sale dates, ownership changes). Not a marketing pitch — a personal briefing. 1d synthesis service + 0.5d card surface. Suppresses on dismissal or after 24h — one good "welcome back" feels personal; multiple feel canned.

---

## 6. "What's new since you left" content engine

Sigrid's `winback-t30` subject — *"We shipped {{N}} things since you left"* — promises content the system doesn't currently generate. Two failure modes if shipped naively: generic changelog dump (worse than not sending) or missing the personal hook (a churner who left over pricing doesn't care we shipped a new map view).

### 6.1 The content-engine architecture

**Inputs:** `changelog_entries` table tagged with `(audience, category, persona_relevance jsonb)`; `churn_reasons.feature_tag`; `personaVocabulary.ts`.

**Filter algorithm:**
```
def select_changelog_for_churner(org):
  entries = changelog since org.archived_at
  if org.churn_reason == 'missing_feature':
    matching = entries WHERE feature_tag matches org.missing_feature_tag
    if matching: return matching (becomes "we built it" template)
  filtered = entries WHERE persona_relevance includes org.persona
                       AND audience includes org.tier
  return rank by (recency * persona_match_score), top 3
```

If filter returns zero items, the "what's new" template is suppressed — customer instead gets "we know we haven't shipped what you needed yet." Honesty rule: every claim must be falsifiable, specific, verifiable. Banned: "We've made AcreOS better." Required: "We shipped county-coverage for Hudspeth, Presidio, and Brewster on March 14 — your saved scans now run there nightly."

### 6.2 The `we-built-what-you-asked-for` template (the killer send)

Branched out of `winback-t30` for `missing_feature` segment when `feature_requests` join hits:

> Subject: We shipped the {{feature_name}} you asked for
>
> {{firstName}} — when you canceled in {{month}}, you said {{verbatim_reason_quote}}.
>
> We shipped it on {{ship_date}}. Here's the changelog: {{link}}.
>
> If you want to try AcreOS again with this in place: {{return_url}}. Your data is exactly where you left it.
>
> — Thomas

Reactivation rate target: 50-65%. Most important single template in the program. Trivial effort once §3.3's `feature_requests` join exists.

---

## 7. Exclusive offers — what to give, when, to whom

Discount-as-default is lazy and trains both customer and unit economics badly. Offers should be **scarce, segment-specific, reason-justified.**

| Reason | Tier | Offer | Rationale |
|---|---|---|---|
| `pricing` | Solo | 50% off 3 months | Standard discount play |
| `pricing` | Operator | Plan-options call (no discount) | High-value; conversation, not coupon |
| `pricing` | Land-Group | Custom-quote with founder | $799+/mo deserves direct treatment |
| `missing_feature` (shipped) | All | First month free, no other discount | The feature is the offer, not the price |
| `missing_feature` (not shipped) | All | No offer until shipped | Don't bribe past the feature gap |
| `wrong_fit` | All | No offer ever | Suppression wastes less than discounting |
| `competitor` | All | 1-month free + migration assist | Switching cost is the lever, not price |
| `timing` | All | Workspace held warm at no cost; no further offer | Convenience is the offer |
| `inactive_user` | All | Free re-onboarding session + 1mo at 50% | Setup-friction is the cause |
| `unintentional` | All | No offer — fix the card, restore service | Operational, not promotional |

**Offer-stacking ban:** chaining offers (cancel → discount → cancel → bigger discount) trains the system to discount permanently. **One win-back offer per org per 18 months,** enforced in `winback_attempts`. **The "no offer at all" segment matters too** — sending a discount to someone who left over `wrong_fit` or low NPS is brand damage, signals desperation, confirms they were right to leave. The brand is built by who you don't chase.

---

## 8. Ethical limits — the spam discipline

Konstantin §7 covered sender reputation; this is the deeper ethical layer. Win-back is the part of lifecycle where the brand is most at risk because the recipient already said no once. Re-engaging is a privilege, not a right.

### 8.1 The five hard rules

1. **One email per segment-tier per 30 days, ever.** A customer on two segment lists gets only the higher-priority sequence. Priority: `unintentional > timing > missing_feature (shipped) > pricing > competitor > inactive_user > missing_feature (unshipped) > wrong_fit`.
2. **Hard stop after T+90 unless explicit re-opt-in.** A churner who hasn't reactivated in 90 days has chosen. Anything after is opt-in (newsletter preserved) or operational. The "annual ping" in §4.1 is opt-in only — confirmed at exit via single checkbox, default unchecked.
3. **Two-click unsubscribe + opt-down.** Footer offers: unsubscribe-from-winback, unsubscribe-from-everything, just-send-quarterly-newsletter. Opt-down captures 25-35% of would-be unsubscribes.
4. **Reply-stop honored within 60 minutes.** "stop", "remove me", "unsubscribe", "no thanks", any single-word negative auto-sets `users.lifecycle_paused = true` via Sophie's reply-classifier. No human review for opt-out — only for opt-in.
5. **No win-back to customers who churned over a billing complaint or support failure.** If last 30 days included `severity=high` ticket or refund-without-resolution, win-back suppressed entirely — empathy at T+0 only, hand-off to founder. Sending a discount to someone who churned because we screwed up is the worst kind of automated tone-deafness.

### 8.2 Deliverability + brand-test

Konstantin's two-subdomain split (`briefings.acreos.io` transactional / `re-engage.acreos.io` win-back) is right. Additions: engagement gating (no send to churners who haven't opened anything via re-engage in 60d); single hard bounce → permanent suppression; FBL complaint → forever-suppressed across *every* email including transactional (must explicitly re-opt-in via login). Brand-test before any template ships: **would I be embarrassed if a churned customer screenshotted this and posted it?** If yes, rewrite. Customers share angry-discount-emails, not welcome emails.

---

## 9. Measurement — the win-back KPIs

### 9.1 Per-sequence metrics (in `winback_attempts`)

Sends per touch · reply rate at T+0 (target 8-15% — highest of any lifecycle send) · click rate on offer touches (3-8%) · reactivation rate at T+90 by segment (targets in §9.3) · MRR recovered by segment · time-to-reactivation (median days) · **18-month retention of reactivated customers** (the *honest* metric — did they stick this time?).

### 9.2 `/admin/winback` dashboard (extends Sigrid's `/admin/lifecycle`)

1. Quarterly cohort funnel — churned → emailed → opened → replied → reactivated, by reason.
2. Reason-mix over time — rising `missing_feature` is a roadmap signal.
3. Reactivation rate vs. expected — actual vs. §9.3 targets.
4. MRR recovered this quarter (Marisol-adjacent finance metric).
5. 18-month retention of reactivated cohort — the truth-test.
6. Suppression log — auditable proof of ethical-limit enforcement.

### 9.3 Reactivation rate targets (90-day window)

| Segment | Industry median | AcreOS target | Best-in-class |
|---|---|---|---|
| `pricing` | 8-12% | 30-40% | 45% |
| `missing_feature` (shipped) | 30-40% | 50-60% | 65% |
| `missing_feature` (unshipped) | 2-4% | 5-8% | 10% |
| `wrong_fit` | 3-6% | 5-8% (don't optimize) | 10% |
| `competitor` | 8-12% | 25-30% | 35% |
| `timing` | 35-45% | 60-70% | 75% |
| `inactive_user` | 4-8% | 10-15% | 20% |
| `unintentional` | 30-50% | 55-70% | 80% |

**Composite quarterly reactivation target:** 18-25% of all churners reactivated within 90 days. Konstantin's "best-in-class 50%" applies only to saveable segments (`missing_feature`-shipped + `timing` + `unintentional`); composite is dragged down by `wrong_fit` and `inactive_user`.

---

## 10. The 1-week win-back bootstrap sprint

Builds on Konstantin's `winback_attempts` table and Sigrid's 5-touch skeleton.

| # | Item | Effort | Why | Cross-ref |
|---|---|---|---|---|
| 1 | **`CancelFlow.tsx` + reason classifier (§3.1) + `feature_requests` table.** Force all cancels through survey; capture verbatim + tag. Disable Stripe portal cancel. | 1.5d | Without segmentation, the whole sequence collapses to one-size-fits-all | Konstantin §6; §3 |
| 2 | **Reason × tier segment routing (§2).** Eight distinct sequences in trigger registry; priority ordering for multi-segment churners. | 1d | Segmentation matrix made executable | §2 |
| 3 | **`/return` tokenized one-click reactivation + Stripe restore action (§5.1).** | 1.5d | Conversion-to-reactivation handoff that determines if any of this works | §5 |
| 4 | **"What's new since you left" content engine (§6) + `changelog_entries` tagging.** Filter algorithm + persona ranking. | 1d | The `winback-t30` content makes-or-breaks the T+30 conversion window | §6 |
| 5 | **`we-built-what-you-asked-for` template wired to changelog publish hook (§6.2).** | 0.5d | Highest-converting single template in the program | §6.2 |
| 6 | **Involuntary churn dunning sequence (§2.2).** Stripe webhook differentiation; smart-retry sequence. | 1d | Largest hidden saveable segment | §2.2 |
| 7 | **Ethical-limit enforcement: 30d frequency cap, T+90 hard stop, opt-down center, reply-stop classifier, complaint-suppression (§8).** | 1.5d | Without this, the program will eventually wreck active-user briefings | §8 |

**Total: ~8 dev-days, parallelizable in 1 week.** **If forced to pick three:** #1 (segment classifier — without it nothing targets), #3 (one-click reactivation — without it email conversion bounces in return flow), #7 (ethical limits — without it the program is a deliverability time bomb). **Defers to month 2:** A/B subject testing (need volume), annual opt-in re-engagement (need 90 days of program data), 18mo reactivated-cohort retention dashboard. **Hard-no, ever:** discount-stacking, win-back to customers who left over a support failure, automated win-back to anyone who replied "stop."

---

## 11. What I'd tell the founder

A churner who returns becomes the most loyal cohort you have (15-25% higher 18mo retention than original signup, having now compared AcreOS to its absence). A churner who returns *and* feels manipulated by the win-back becomes the loudest detractor. The program lives on that knife-edge.

Two highest-leverage investments at AcreOS's stage: (1) **build the cancellation-survey-to-segment classifier first** — every other tactic in this audit assumes segmentation works; without it, the program is one-size-fits-all, the 8%-vs-25% composite reactivation gap; eighteen-point swing from one engineering week. (2) **Wire in-product reactivation hooks before scaling the email program** — a T+30 email converting at 30% click but bouncing in the return flow at 50% is a net 15% reactivation. The email is the easier half; the in-product half is what everyone skips.

Build those, run the §10 sprint, surface the §9 dashboard, and AcreOS goes from "we send a goodbye email" to "we have a structured program that recovers 20-25% of churn quarter over quarter." That MRR compounds. Composite quarterly reactivation rate is the cleanest single number to put on `/founder-home` — hardest-to-fake retention metric, and the one Series-A investors most appreciate when they see it trending up-and-to-the-right.

The single sentence I'd put on the wall: *the win-back program's job is not to recover revenue — it's to leave every churner with the impression that AcreOS handled their cancellation better than the company they switched to handled their signup.* Reactivation is the byproduct. The reputation is the asset.

— Indigo Marshfield · 2026-05-01
