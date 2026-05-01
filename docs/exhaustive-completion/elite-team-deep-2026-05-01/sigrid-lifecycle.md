# Sigrid Berg — Lifecycle Marketing Audit (Deep Wave 2)

**For:** Thomas Norton, founder, AcreOS
**Date:** 2026-05-01
**Lens:** 8 years on Stripe + Linear lifecycle teams. Most early-stage SaaS leaves 30-50% of expansion + retention revenue on the table because they treat lifecycle as a stack of one-off campaigns instead of a program. A program has a calendar, a coverage map, an exit-rule engine, and a single voice across every send. AcreOS today has one and a half of those.
**Builds on:** Yuna (`elite-team-2026-05-01/yuna-activation.md` — TTFV 7:30 → 1:30; three competing first-run systems; activation-events gap) · Camila (`elite-team-deep-2026-05-01/camila-cs.md` — D1/D7/D30 arc; 11-message in-product sequence; pre-churn ladder; win-back skeleton) · Eden (`elite-team-deep-2026-05-01/eden-copy.md` — `emailService.ts` corporate voice; `onboarding-sequence.md` not wired) · Mira (`elite-team-deep-2026-05-01/mira-microcopy.md` — voice rules, banned words, apology pattern).

---

## 1. One-line verdict

AcreOS has a 7-email Markdown sequence that never sends, six built-in HTML templates from a different company, two activation systems Yuna mapped, a 30-day journey Camila scaffolded, and zero programs covering the 80% of customer lifetime that happens *after* day 30 — habit, expansion, dormancy, win-back, NPS-loop, power-user, monthly newsletter — so the lifecycle program is currently a 30-day strip with an ocean of silence on either side. Twelve well-placed messages and a real ESP close it.

---

## 2. The lifecycle coverage map — what AcreOS sends today vs the program it should run

A lifecycle program is judged by **coverage** (does every meaningful customer state have a touch?) not by send-count. The grid below is how I read AcreOS today.

| Lifecycle phase | What should fire | What fires today | Gap |
|---|---|---|---|
| Pre-trial nurture | 0 (not selling cold yet — pre-launch) | 0 | Acceptable for now |
| Welcome / activation (D0–D14) | 5–7 emails, persona-flexed | 0 in production (Markdown exists, not wired); 1 corporate `welcome` HTML | **Critical** |
| Education drip (D7–D90) | 6–8 BiggerPockets-tier teaching emails | 0 | **Critical** |
| Activation nudges (event-based) | 4–6 conditional nudges ("imported, no mailer sent") | 0 | **Critical** |
| Habit formation (weekly) | 1 weekly "your week in numbers" | 0 | **High** |
| Re-engagement (5d/14d/30d/60d) | 4-step ladder | 0 customer-facing (Camila §6 — only writes to founder inbox) | **Critical** |
| Win-back (post-cancel T+0/T+2/T+7/T+30/T+90) | 5-step | 0 (`autonomyBootstrap.ts:278` has the *concept* memorized, no executor) | **Critical** — and the FAQ on the landing page already promises this email |
| Expansion / usage triggers ("you've maxed mailers") | 3–4 trigger-based | 0 | **High** |
| NPS survey + follow-up branches | 1 send + 3 branches by score | Backend table exists, no UI surface, no follow-up | **High** |
| Monthly newsletter | 1/mo, ~12/yr | 0 | **Medium** — defer to month 2 of program |
| Power-user recognition | Quarterly cohort touch | 0 (Camila §7 designs it; nothing built) | **Medium** |
| Transactional (verification / password / receipts) | Always-on, in voice | Exist but in wrong voice + wrong palette (Eden §5.2) | **High** |

**Composite coverage today: 1 of 12 phases. Three months of program work; two-week bootstrap covers the four that bleed money.**

---

## 3. The recommended program — 14 messages mapped to triggers

This is the inventory I'd commit to in v1. Messages 1–11 overlap Camila's 30-day spine (good — single source of truth) and extend through expansion + retention. Messages 12–14 are the long-tail surfaces that Camila explicitly scoped to a follow-up sprint.

Every send obeys the global rules in §5. Every template lives in `content/emails/{slug}.md`, rendered server-side.

### 3.1 The fourteen messages

| # | Slug | Trigger | When | Subject (in voice) | Purpose | Cross-ref |
|---|---|---|---|---|---|---|
| 1 | `welcome-d0` | `signup_complete` | T+5min | Your workspace is live — here's what runs overnight | Set the "we work while you sleep" expectation | Camila §4 #1; Yuna §7 |
| 2 | `reentry-d0-evening` | `no_return_after_first_session` | T+6h | Pax found three more opportunities while you were away | Re-entry hook | Camila §4 #2 |
| 3 | `morning-briefing-d1` | `morning_briefing_ready AND first_briefing_for_user` | D1 7am local | {{count}} new opportunities scored 75+ in {{county}} | Aha #2 — "the product runs without me" | Camila §4 #3 |
| 4 | `morning-briefing-recurring` | `morning_briefing_ready` (D2+) | D2+ 7am local | Last night: {{parcels_scanned}} parcels, {{opportunities}} worth a look | Habit-formation, not just D1 reinforcement (this is the workhorse) | Camila §4 #4 — **extended** to recurring, not just D2 |
| 5 | `nudge-first-artifact` | `D3 AND NOT first_artifact_generated` | D3 9am local | Want Pax to draft your first offer letter? | Drive Yuna's Aha #3 (offer-letter generation) | Camila §4 #5; Yuna §10 candidate B |
| 6 | `nudge-engagement-low` | `D5 AND engagement_score < 0.4` | D5 morning | Quick check-in, {{firstName}} | Personal-tone re-engage | Camila §4 #6 |
| 7 | `cohort-recap-d7` | scheduled D7 | D7 4pm local | Your week-1 recap: {{leads_reviewed}} reviewed, {{compares_to_top}} | Identity moment — Yuna's apex (§10 candidate A territory) | Camila §4 #7; Yuna §7 |
| 8 | `nudge-import` | `D10 AND NOT first_import_completed` | D10 morning | Your existing leads in 30 seconds | Drives Yuna's "I can't go back to Excel" (§10 cand. A) | Camila §4 #8 |
| 9 | `weekly-numbers` | scheduled every Sunday 5pm local, starting D14 | Weekly | Your week in numbers: {{scans}} scans, {{opportunities}}, {{artifacts}} | **Habit-formation core** — quantifies the unseen overnight work | New (extends Camila §4 #9 from one-shot to recurring) |
| 10 | `nudge-mailer-unused` | `import_completed AND no_mailer_sent_in_7d` | event-based | You imported {{N}} leads — none have heard from you yet | Activation nudge (the example in your brief) | New |
| 11 | `nps-d21` | scheduled D21, fires once per user | D21 morning | What's missing? Two-minute survey | Discovery → product feedback loop, fires NPS | Camila §4 #10 |
| 12 | `nps-followup-promoter` | `nps_score >= 9` | T+1d after submit | Would you tell one person? | Power-user / referral conversion | New (closes Camila §7 loop) |
| 13 | `nps-followup-passive` | `nps_score 7-8` | T+1d | What's the one thing? | Single-question reply email | New |
| 14 | `nps-followup-detractor` | `nps_score 0-6` | T+30min | Want 15 minutes with Thomas? | Save the relationship before they cancel | New (Camila §6 ladder feeds this) |

### 3.2 The graduation message — D30 verdict (3-way branched)

Per Camila §4: at D30, `onboardingAutonomy.day30_activation_verdict` classifies as `active` / `at_risk` / `churned`. Three diverging templates:

- `verdict-active`: "You're a power user. Here's what most operators don't know yet." → unlocks Deal Hunter automation + advanced mailer cadence.
- `verdict-at-risk`: "We noticed you've slowed down. 15-min call?" → real Calendly link.
- `verdict-churned`: "Before you go — what didn't work?" → 1-question reply email, no escape hatch.

Counts as messages 15a/15b/15c — only one fires per user.

### 3.3 Re-engagement ladder (Camila §6 — formalized as program)

Transport the four-tier intervention as four templates, gated on the unified `HealthScore`:

| # | Slug | Trigger | Subject |
|---|---|---|---|
| 16 | `dormant-5d` | 5d no login, was healthy | Pax found four things while you were away |
| 17 | `dormant-14d` | 14d no login | Quick question — is it working? |
| 18 | `dormant-30d` | 30d no login + low health | Everything OK? |
| 19 | `dormant-60d` | 60d no login | Last check before we pause your account |

Exit rule: any login or click drops the user back to Healthy band → ladder resets.

### 3.4 Win-back (post-cancel)

Camila §6 designed this; here's the mailing arm:

| # | Slug | Trigger | Subject |
|---|---|---|---|
| 20 | `winback-t0` | `subscription.canceled` Stripe webhook | Sorry to see you go — one question |
| 21 | `winback-t2` | T+2d, no reactivation | Pause-not-cancel? |
| 22 | `winback-t7` | T+7d, no reactivation | A note from Thomas |
| 23 | `winback-t30` | T+30d | We shipped {{N}} things since you left |
| 24 | `winback-t90` | T+90d | Last reminder before we delete your data |

### 3.5 Expansion (the part everyone skips)

This is the 30-50% of money on the table I opened with. Three event-based templates:

| # | Slug | Trigger | Subject |
|---|---|---|---|
| 25 | `expansion-mailer-cap` | mailer volume ≥ 90% of plan cap in 30d | You're maxing mailers — here's the math on Operator |
| 26 | `expansion-seat-add` | second user invited but plan = Solo | Bringing on a partner? Your plan has a one-seat ceiling |
| 27 | `expansion-county-cap` | scanning 3+ counties on a 1-county plan | You've scanned three counties — let's clear the cap |

**Voice rule for expansion:** never sell upgrade — show the math. The customer self-prices.

### 3.6 Power-user + monthly newsletter

| # | Slug | Trigger | When |
|---|---|---|---|
| 28 | `power-user-quarterly` | HealthScore ≥ 90 for 30d | Quarterly | "You're in the top 5% of operators on AcreOS" |
| 29 | `monthly-newsletter` | scheduled | First Tuesday of month | "What we shipped, what we learned, what's coming" |

The monthly newsletter is the **only** message in this program signed `— The AcreOS team` instead of `— Thomas`. It's the brand-collective surface. Defer to month 2 of program rollout.

**Coverage check:** 27 distinct templates covering all 10 lifecycle phases in your brief. The two-week bootstrap (§7) ships 19 of them — every send marked **Critical** in §2.

---

## 4. Tooling — stay with `emailService.ts`, or add Customer.io / Loops?

**Recommendation: stay with `emailService.ts` for v1, add Loops in month 2, never add Customer.io until you're past 1,000 paying customers.**

**Why not Customer.io now:** $150/mo + ramp time + a workflow editor that no one on a 4-person team has bandwidth to maintain. Most early-stage teams adopt it, ship two campaigns, then watch it become a graveyard of half-built journeys. Premature adoption is itself the failure mode.

**Why not Loops now:** Loops is the closer fit (cleaner DX, founder-friendly, $49/mo) and the right month-2 move. But adopting it before the 9 critical templates exist picks the tool before knowing the workload. Build the program in `emailService.ts`, prove the trigger model works, then port to Loops with the templates already validated. The migration is mechanical (~1 dev-day) because Markdown templates + trigger registry separate "what to send" from "when to send."

### 4.1 What `emailService.ts` is missing for v1 (the 1-week build)

`emailService.ts:1-200` (per Eden §5.2) handles transport via SES, has 6 templates baked into TS files. To run the program above, it needs:

1. **Markdown template loader.** Read `content/emails/{slug}.md` at send time, parse front-matter for subject + reply-to, render Handlebars-style `{{variables}}`. Eden §5.4 already proposes this; it's a half-day of code. Pulls all 27 templates out of code into a directory engineers and writers can both edit.
2. **Trigger registry.** A typed map `triggerName → handler({user, org, context}) → {shouldSend, vars}`. Replaces the scattered `if-then-send` calls. New triggers added in one file.
3. **Suppression rules engine.** Frequency cap (max 1/24h, max 4/week per user), persona rules (a `note_investor` doesn't get the `nudge-mailer-unused` send), unsubscribe token, manual hold (when a customer replies "stop emailing me," set `users.lifecycle_paused`).
4. **Delivery log.** A `lifecycle_sends` table: `{user_id, template_slug, trigger_id, sent_at, opened_at, clicked_at, replied_at, bounced, suppressed_reason}`. This is what makes §6 measurement possible.
5. **A/B harness (defer to month 2).** Don't optimize subject lines before you have 1,000 sends/month. Until then, write one subject line, ship it.

### 4.2 What stays in `emailService.ts` forever

Transactional sends (verification, password reset, receipts, dunning #1) should *not* live in Loops/Customer.io. Marketing ESPs are not the place for security-critical transactional traffic — bounce rates, reputation, deliverability, and audit trails all live better in your own SES integration. Eden §5.2 flagged the corporate-voice rewrite of these three; that rewrite ships in `emailService.ts` and stays there.

---

## 5. Voice rules — the lifecycle program voice (cross-ref Eden + Mira)

Eden §7 codified long-form voice; Mira §6 codified microcopy. Lifecycle email sits in between — longer than a toast, shorter than `/why`. The rules below are the program-specific overlay.

### 5.1 The five voice rules for every send

1. **Subject lines are sentence case, no exclamation, name a number when one exists.**
   - Bad: `Welcome to AcreOS!` / `Boost Your Pipeline With These 5 Tips`
   - Good: `Your workspace is live — here's what runs overnight` / `7 new opportunities scored 75+ in Hudspeth`

2. **Open with a sentence the founder would say at a coffee.**
   - Eden §7.1 rule. The first sentence of every lifecycle email should pass the "kitchen table" test. If it sounds like a CRM, rewrite.

3. **Sign with `— Thomas` while ≤500 customers; `— Pax` after; `— The AcreOS team` only on the monthly newsletter.**
   - The `from:` follows the same rule (Camila §4): `thomas@acreos.com` reply-to while pre-50, `pax@acreos.com` after.
   - **Never** `noreply@`. Every send is reply-able. Replies route to `/admin/support` and trigger Sophie classification.

4. **Banned words on every customer send** (extends Mira §6 + Eden §7.2):
   - "Please" — voice break (Mira §4.4)
   - "Successfully" / "successful" — adverb leak (Mira §4.5)
   - "AI" / "AI-suggested" / "AI-powered" — use Pax (Mira §4.7; Eden §5.1 flagged Day-4 leak)
   - "Real estate" — use "land" (Eden §9; user memory `feedback_terminology.md`)
   - "We're excited to announce" — Eden §7.2
   - "Empower / streamline / leverage / robust / best-in-class / cutting-edge / seamlessly / game-changing"
   - Any phrase pulled from a 2018 SaaS template gallery
   - **And the program-specific bans:** "Just checking in," "Hope you're well," "I wanted to reach out about," "Following up on my last email" — corporate-CS phrasing that signals automation. The voice doesn't pretend to be hand-written; it actually sounds hand-written by writing fewer words.

5. **End on a falsifiable specific, not an inspirational platitude.**
   - Bad: `We're excited to grow with you.`
   - Good (FAQ): `We don't hold your data hostage — and we'll send you a personal email asking what we missed.`

### 5.2 Persona-flexing rules

Pull every variable that names a thing-the-customer-cares-about from `personaVocabulary.ts`:

- A `note_investor`'s nudge-import email mentions "yield-to-maturity," not "tax-delinquent parcels."
- A `wholesaler`'s expansion email mentions "assignment fees," not "acquisition cap."
- A `landlord`'s morning briefing mentions "vacancies and lease renewals," not "scored 75+ on motivation."

If a template can't be sensibly persona-flexed, it doesn't ship until it can. The default-persona fallback is `land_investor` (Yuna §5).

### 5.3 The "no marketing in the marketing email" principle

Best lifecycle move in the Stripe handbook: the email looks like an internal note, not a campaign. No header image (the gradient hero Eden §5.2 killed stays dead). No "View in browser" link (newsletter excepted). No 4-column footer — one line: `AcreOS · Reply to this email — I read every one. — Thomas` + unsubscribe. No social-icon row. Also defensive: Gmail's tab-classifier sends 4-column-footer email to Promotions, plain emails to Primary. Plain wins twice.

### 5.4 The reply hook

Every lifecycle email except the recurring habit-formation send (`weekly-numbers`) ends with one of three reply prompts:

- "Hit reply — I read every one. — Thomas"
- "Reply with one word: {{specific question}}." (e.g., "Reply with the county you'd hunt next.")
- "If something's off, reply. Even if it's 'this isn't for me.'" (Camila §6 dormant-30 voice.)

Reply rate is the **best** lifecycle metric you can pick at this stage (§6.4). Optimize for reply, not click.

---

## 6. Measurement — open / click / activation impact

### 6.1 The metrics stack

Three layers, in order of importance:

1. **Behavior change** (the only one that matters): did the lifecycle send move the customer to a new state?
2. **Engagement** (proxy for #1): reply, click, open.
3. **Hygiene** (alarm bells only): bounce, complaint, unsubscribe.

### 6.2 Per-template metrics — what to track in `lifecycle_sends`

For every template, the dashboard shows:

| Metric | How to read |
|---|---|
| **Sends** | Volume — sanity check |
| **Open rate** | Apple MPP makes this dirty — use as relative trend, not absolute |
| **Click rate** | The cleanest engagement signal — target 5–15% for activation, 2–5% for newsletters |
| **Reply rate** | The **only** signal that scales with relationship — target 1–3% for personal-tone emails (~10× industry) |
| **Activation lift** | % of recipients who hit the next milestone within 7d, vs. control cohort |
| **Suppression rate** | If > 5%, frequency cap is wrong |
| **Unsubscribe** | If > 0.5%/send, the audience is wrong, not the copy |
| **Reply sentiment** | Sophie classifies replies; surface positive/neutral/negative split |

### 6.3 Program-level KPIs (the founder-dashboard view)

Six numbers on `/admin/lifecycle`:

1. **Time-to-first-aha** (Yuna §2 metric — derived from `activation_events`).
2. **D7 / D30 retention** by signup cohort, with email-clicked vs not split.
3. **Reply rate program-wide** (the customer-relationship pulse).
4. **Win-back conversion** (T+0 → reactivated %; null today since sequence doesn't ship).
5. **Expansion-prompt → upgrade conversion** (target 8–15% on usage triggers).
6. **NPS distribution** + 30-day trend (currently captured into `npsResponses` with no surface — Camila §5).

### 6.4 Reply rate over click rate (the unconventional pick)

Most teams optimize click rate because it's measurable and immediate. At AcreOS's stage and brand, reply rate is the better target:

- **Click** measures whether a CTA worked. **Reply** measures whether a *relationship* exists.
- Replies generate Sophie-classified support insights → product roadmap signal (Camila §8 customer-interview cadence).
- The brand promise on the landing FAQ — *"we'll send you a personal email asking what we missed"* — only pays out if the customer replies. Reply rate is the brand-keeping metric.
- Reply rate is also the metric that protects against ESP migration regret. Customer.io optimizes click; humans optimize reply.

Pick reply rate as the north-star lifecycle metric. Click is the tactical metric.

### 6.5 Holdout testing + the dashboard

For every event-based send (messages 5, 6, 8, 10, 25–27, 16–19, 20–24): hold out 5–10% of eligible recipients as control. Compare 7-day milestone-completion rate treatment vs. control. The only honest answer to "did the email work?" Without holdouts, every campaign appears to work and no one can tell what to cut. Implementation: `lifecycle_sends.was_holdout: bool`.

`/admin/lifecycle` page (~1.5 days): top-row KPIs from §6.3; template grid (slug, 30d sends/open/click/reply/activation-lift, sparkline); reply-inbox preview with Sophie sentiment chip; holdout-vs-treatment chart; suppression log. Plug into `cohort-retention-dashboard.tsx` (Yuna §8).

---

## 7. The 2-week lifecycle bootstrap sprint

Sequenced for impact-per-day. Every item is wiring existing pieces or thin work on a known surface. **Total: ~12 dev-days + 2 days of writing. One engineer + Thomas.**

### 7.1 Week 1 — infrastructure + the four critical sends

Goal: move from "no program" to "every new customer hits a real lifecycle." This week alone closes the bleeding.

| # | Item | Effort | Why first | Cross-ref |
|---|---|---|---|---|
| 1 | **Markdown template loader + trigger registry** in `emailService.ts`. Replace 6 baked-in templates with a `content/emails/{slug}.md` directory. Wire `personaVocabulary.ts` into render context. | 2d | Without this, every other item is a copy-paste fork | Eden §5.4; §4.3 |
| 2 | **Rewrite the three transactional templates** in voice (welcome, verification, password-reset). Match the homestead palette and the Markdown Day-0 voice. | 0.5d | First three emails every customer receives; Eden §5.2 is screaming about this | Eden §5.4 |
| 3 | **Wire welcome (#1), reentry-D0 (#2), morning-briefing (#3, #4), nudge-first-artifact (#5), cohort-recap-D7 (#7)** into `onboardingAutonomy` handlers. Replace each handler's intent-string return with an actual `emailService.send()` call. | 3d | Camila's spine becomes real; the 30-day journey stops being theatre | Camila §4 |
| 4 | **`lifecycle_sends` log table + delivery telemetry** (sends/opens/clicks/replies/bounces/suppressed_reason). | 0.5d | Without it, §6 is impossible | §6 |
| 5 | **Frequency cap + suppression rules engine.** Max 1/24h, 4/week, persona suppression, unsubscribe token, `users.lifecycle_paused` honor. | 1d | Defends against the worst lifecycle failure mode (over-sending) | §4.3 |
| 6 | **Reply-routing into `/admin/support` + Sophie classification.** Replies to `thomas@acreos.com` create support threads with sentiment chip. | 1d | The reply-rate metric (§6.4) is meaningless without this | Camila §6 |

**Week 1 ships:** 7 templates live, transport and frequency caps in place, replies route, telemetry logged. Every D0 → D7 send in the program now fires for real customers.

### 7.2 Week 2 — the long-tail sends + measurement

Goal: cover the dormancy + win-back + NPS holes; ship the dashboard so the program is observable.

| # | Item | Effort | Why | Cross-ref |
|---|---|---|---|---|
| 7 | **Re-engagement ladder (#16–19)** — four dormant templates wired to the unified HealthScore bands. | 1.5d | Camila §6 — highest-leverage retention fix | Camila §6 |
| 8 | **Win-back sequence (#20–24)** — `winback_attempts` table + 5-touch automation kicked off by `subscription.canceled` Stripe webhook. | 1.5d | The FAQ on the landing page already *promises* the T+0 email; we are currently lying | Camila §6; Eden §2.9 |
| 9 | **NPS micro-survey UI (#11) + the three follow-up branches (#12, #13, #14).** `NpsMicroSurvey.tsx` (Camila §5 #6) renders in-app D7; submit triggers branch. | 1.5d | Closes the loop on backend NPS that captures and disappears today | Camila §5; Camila §4 #10 |
| 10 | **Weekly habit-formation send (#9)** — Sunday 5pm cron that pulls scans, opportunities, artifacts from the user's week. | 1d | The single highest-leverage habit message; this is the email that builds the "I read AcreOS every Sunday" muscle | New |
| 11 | **Activation nudges (#10) + expansion triggers (#25–27).** Event-based: import-but-no-mailer, mailer-cap, seat-add, county-cap. | 1.5d | The "money on the table" sends; expansion alone pays for the engineer | §3.5 |
| 12 | **`/admin/lifecycle` dashboard** — six KPIs, template grid, reply inbox, holdout chart, suppression log. | 1.5d | Without it, the program is invisible to the founder; we ship blind | §6.6 |
| 13 | **Holdout flag + cohort comparison** plumbing (`lifecycle_sends.was_holdout`, server randomization, dashboard chart). | 0.5d | The only honest answer to "did the email work?" | §6.5 |

**Week 2 ships:** 19 of 27 templates live, dashboard + measurement in place, dormant + win-back + NPS + expansion programs all running. Eight templates remain (D30 verdict 3-way, Power-user quarterly, monthly newsletter) — defer to month 2 alongside the Loops port.

### 7.3 Sequencing dependencies

```
Week 1: 1 → 2 ‖ 4 → 3 → 5 → 6
Week 2: 7 ‖ 10 → 8 → 9 → 11 → 13 → 12
```

(`‖` = parallel; otherwise sequential.) Item 1 (Markdown loader) gates everything; do it Monday morning, day one.

### 7.4 What to defer past the bootstrap

D30 3-way verdict (#15a/b/c) — month 2, needs classifier hardened (Camila §3). Power-user quarterly (#28) — needs `/admin/power-users` query (Camila §7); month 2. Monthly newsletter (#29) — needs editorial cadence; month 2. Loops migration — month 2 once volume + authoring needs justify it. A/B subject-line testing — defer until ≥1,000 sends/month per template. Pre-trial nurture sequence — defer until paid acquisition; pre-launch, the landing page does the job.

---

## 8. Closing note

AcreOS already has the *content* of a great lifecycle program. Eden's Markdown sequence is in voice. Camila's 30-day spine is correctly designed. Yuna's activation milestones are the right triggers. The gap is purely the program-engineering layer — the Markdown loader, the trigger registry, the suppression rules, the delivery log, the reply-routing, the dashboard. Two weeks of one-engineer work transforms a doc folder into a real lifecycle program that runs every minute, suppresses correctly, signs with a person's name, and gets opened by Land Investors who reply with single-line gratitude.

Most early-stage SaaS leaves 30-50% of expansion + retention revenue on the table not because they can't write the emails, but because they never wire the program. AcreOS is two weeks from being the company that did.

The single sentence I'd put on the wall: *the lifecycle program's job is not to send email — it's to make the customer feel like one specific person has been paying attention to them since the day they signed up.* Reply rate is the only honest measurement of whether that's true.

— Sigrid Berg · 2026-05-01
