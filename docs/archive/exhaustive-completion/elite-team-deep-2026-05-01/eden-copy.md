# Eden Volkov — Long-Form Copy Audit (Deep Wave 2)
**For:** Thomas Norton, founder, AcreOS
**Date:** 2026-05-01
**Lens:** Full surface copy beyond microcopy. Sections, sentences, sequences. The places where AcreOS asks the reader for ten seconds of attention instead of one.
**Builds on:** Mira (`elite-team-deep-2026-05-01/mira-microcopy.md` — toast/dialog/empty-state inventory) · Asher (`elite-team-2026-05-01/asher-ceo.md` — voice strategy + pricing-page split + founder letter).

---

## 1. One-line verdict

You have a genuinely great founder voice on the landing page and a properly curated 14-day onboarding email sequence — and the moment a customer crosses any threshold (auth wall, onboarding wizard, password-reset email, app-store metadata, in-app help, status page, the `/pricing` route), they meet a different writer who learned voice from a 2018 SaaS template gallery. The fix is not invention — it's deletion. Five surfaces account for 80% of the damage. Two days of writing kills it.

---

## 2. Landing page copy critique — section by section

The landing copy lives in `client/src/pages/landing/copy.ts` plus seven JSX files. Each is reviewed below. Voice scores are out of 5; "Voice score" means: does this read like the same person who wrote `/why`?

### 2.1 Hero (`Hero.tsx` + `copy.ts:hero`) — **5/5. Don't touch it.**

Eyebrow `A letter from Thomas`, three-line title `I built this / because I needed it. / Maybe you do too.`, the subheadline naming 200 deals and `thomas@acreos.io`, the proof line `12 investors in private beta. $1.4M closed. 0 of them have left.` — this is the best SaaS hero I've read this year. Specific, falsifiable, slightly weary, no superlatives. The Atlas/Pax/Sophie cards on the right do real work — they show what "every agent shows its work" looks like before you've explained it.

The only adjustment: the proof line will date. If `0 of them have left` becomes `1 of them has left` next month, the line becomes a liability. Plan for the rewrite ("11 of 12 still on, one took a break to close out a 1031") so it stays specific instead of going generic.

### 2.2 How it works (`copy.ts:how`) — **4.5/5.**

`Three steps. Most happen on their own.` is exactly the right shape. The three step bodies are the cleanest in the file — `The same conversation you'd have with a partner.` is a sentence you can hear out loud. Step 3, `Keep your judgment where it belongs`, is the brand thesis in eight words. Ship as-is.

Tiny tweak: step 2's body is `List pulled, mail sent, replies drafted. Atlas, Pax, and Sophie work overnight.` — the verb-list comma splice works for rhythm but reads slightly stiff. Consider: `Lists pull. Mail goes out. Replies sit ready when you wake up.`

### 2.3 Agents (`Agents.tsx` + `copy.ts:agents`) — **5/5.**

`I named them after people I trust.` followed by `Atlas does the math. Pax handles the conversation. Sophie watches the paper.` — three verbs, three nouns, three coworkers. This is the section your competitors will copy.

### 2.4 Day in life (`DayInLife.tsx` + `copy.ts:day`) — not deep-read; flagged for separate review

The eyebrow `A Tuesday in May` and headline `Two versions of the same week.` set up the side-by-side correctly. The before/after content inside the component should follow this rule: the *Before* column should sound like a frustrated investor's actual Tuesday (not a strawman); the *After* column should be quiet, not triumphant. If the After reads like a victory lap, the section's earned subtlety dies.

### 2.5 Features (`Features.tsx`) — **3.5/5. Weakest landing section.**

12 cards in `Find / Analyze / Reach / Close / Service / Operate`. Titles are right (`Buy-box agent`, `Pax inbox`, `Sophie ledger`). Eight of twelve descriptions are in voice (`Skip-traced, deduped, sorted by likelihood. Ready every Monday morning.` / `Atlas defends the price.` / `Bring on a VA, a partner, or your spouse.`). The four generic ones drag the section:

- **Mail platform** — `Multi-touch campaigns. Tracked. A/B tested. Full creative control.` Generic. Rewrite: `Direct mail that doesn't look like a mailer. Tracked, A/B'd, signed by you — not a logo.`
- **E-sign + escrow** — Per Thomas's "native e-sign" memory this should be the proudest line in the section, not "without leaving the app." Try: `Native signing. Title hand-off in two clicks. No DocuSign tab.`
- **Automation builder** — `No-code workflows.` `No-code` is a 2022 word. Try: `Workflows you can read out loud. Trigger anything off any event. Pause in a click.`
- **Audit log** — `Every agent action — what, when, why, what data it used. Full transparency.` Drop "Full transparency" — the sentence already proves it.

30 minutes of rewrites and Features matches the rest.

### 2.6 Founder note on landing (`FounderNote.tsx` + `copy.ts:founder`) — **4/5, but it competes with `/why`.**

Five paragraphs of good copy. But: this is **not the same letter** as `/why`. The two tell overlapping stories with non-overlapping language. A reader who reads both — and they will — sees seams. **Decision required:** consolidate (pick the better one) or differentiate (landing = "why I built it"; `/why` = "founding document"). Right now they read like two drafts by accident. If kept distinct, the landing version should be shorter (4 paragraphs); `/why` should be longer (current + 2–3 paragraphs about the *click moment* — when AcreOS went from "tool for me" to "product for us").

### 2.7 Quotes (`Quotes.tsx`) — flag, not graded

Asher already noted: verify these are real, named, attributable. If they aren't, kill them — *no testimonials* is a stronger move on this kind of brand than testimonials a reader can't Google.

### 2.8 Pricing (`Pricing.tsx`) — see §3

### 2.9 FAQ (`FAQ.tsx`) — **5/5. Best-in-class.**

Eight questions, each in a sentence the founder would say at a coffee. The autonomy-slider answer (`Off, Suggest, Review-then-send, or Auto-send. Default is Suggest.`) is a worldview shipped as a feature description. The cancellation answer (`Export everything to CSV in one click. We don't hold your data hostage — and we'll send you a personal email asking what we missed.`) is the cancellation policy I want every SaaS to have. **Make every word of this FAQ load-bearing in the rest of the product** — if the cancellation flow doesn't ship what this FAQ promises (§7.3 of Asher), the section becomes a lie by next quarter.

### 2.10 Final CTA (`FinalCTA.tsx` + `copy.ts:cta`) — **4.5/5.**

`Try it for two weeks. See what you think.` is correct. The sub `No card, no calls, no pressure. If it's not for you, no hard feelings — and you can email me to tell me what was missing.` is the only "final CTA" I've ever read that doesn't sound like a closing pitch. Keep.

### 2.11 Landing page summary

| Section | Voice | Length | Notes |
|---|---|---|---|
| Hero | 5/5 | Right | Don't touch |
| How it works | 4.5/5 | Right | Tiny rhythm tweak in step 2 |
| Agents | 5/5 | Right | Brand-defining |
| Day in life | (not graded) | — | Audit Before/After tone |
| Features | 3.5/5 | Right | 3 cards drag the section down |
| Founder note | 4/5 | Slightly long | Decide vs. `/why`; consolidate or differentiate |
| Quotes | (not graded) | — | Verify real-and-named, or kill |
| Pricing intro | 5/5 | Right | The intro is right; the tier desc is fine here |
| FAQ | 5/5 | Right | Make every promise load-bearing in product |
| Final CTA | 4.5/5 | Right | Ship as-is |

**Composite landing voice: 4.4/5.** Public-side AcreOS is unusually good. The damage is across the auth wall.

---

## 3. Pricing page copy — per-tier rewrite proposals

You have **two pricing pages with two pricing models** (Asher §4 caught this — I confirm). The landing's `Pricing.tsx` shows Solo $199 / Operator $499 / Operation $1,290. The standalone `pages/pricing.tsx` shows Free $0 / Starter $20 / Pro $49 / Scale $79. **A prospect who clicks the landing's `Pricing` nav anchor sees one story; a prospect who clicks the footer's `Pricing` link sees a different product.** Resolve before you ship anything else copy-related.

### 3.1 Recommendation: the landing's tiers are the brand. Adopt them. Rewrite `/pricing` to match.

Reasoning: $499 is the price the *founder voice* implies. A founder who closed 200 land deals does not sell $20/mo software to other 200-deal closers. The $20–$79 tiers are a category mistake — they say *"prosumer CRM trying to be enterprise"* and contradict every line of `/why`. Pick the operator tiers; the prosumer tier reads as a different company.

### 3.2 Rewrite — landing tiers, voice-correct

**Solo ($199/mo)** — `For investors closing one to four deals a month.` Body: *"One operator. Two or three counties. Atlas, Pax, and Sophie all on. Mail, mailers, and a real inbox — not a hobby tool."* CTA: `Start your trial`.

**Operator ($499/mo, most popular)** — `For partnerships and small teams.` Body: *"When the operation is more than one person. Roles, permissions, automation builder, and Sophie servicing your notes — so the busywork doesn't expand to fill the team."* CTA: `Start your trial`.

**Operation ($1,290/mo)** — `For full-time operations.` Body: *"When AcreOS is the system of record for the business. Custom integrations, a dedicated success partner, and a quarterly portfolio review I do personally."* CTA: `Talk to us`.

Feature lists stay roughly as-is in `Pricing.tsx` but sentence-cased; add `Priority support (a real human within four hours)` to Operator and `Quarterly portfolio review with Thomas` to Operation. Footer `Every plan includes 14 days free, no setup fees, and migration help from a real human.` — keep verbatim. `migration help from a real human` is a brand sentence.

### 3.3 What to do with the existing `/pricing` page

Three options, ranked:

1. **Best:** Replace the four-tier table with the landing's three-tier copy. Delete the feature comparison matrix (it sells the wrong story — feature counts, not operator class). Add one comparison row at the bottom: *"All plans include AcreOS Mail, Pax Inbox, Atlas comps, Sophie servicing, audit log, and migration help. The plans differ in seats, counties, mailer volume, and the level of human you reach when something breaks."*
2. **Compromise:** Keep `/pricing` as the canonical comparison page; rewrite each tier description in the voice above; keep the matrix but cut feature rows that don't matter to a Land Investor (e.g., `AI requests / day` is a usage cap that has no meaning to the customer — it's an internal metric).
3. **Worst (current):** Two stories, two prices, two products. Pick something within 14 days.

### 3.4 Specific copy fixes on existing `/pricing` (if we keep the prosumer model)

- `:19` `"Explore the platform"` → `"Kick the tires."`
- `:28` `"Replace your spreadsheet"` → `"For your first ten deals."`
- `:36` `"For serious operators"` → `"When you're closing every month."` (Why "serious"? Implies others aren't.)
- `:44` `"For growing teams"` → `"When you're not the only one running deals."`
- `:64` `"AI requests / day"` *(feature row)* → delete or `"Pax actions / day"` (two banned words on customer surface)
- `:125` `"Simple, transparent pricing"` (h1) → `"Honest pricing for honest work."` (matches landing)
- `:127` `"Start free. Upgrade when you're ready..."` → `"No card to start. Cancel any time. Migration help included."`
- `:217` `"Feature comparison"` → `"What's in each plan."`
- `:258` `"Need custom enterprise pricing?"` → `"Running something bigger?"` ("Enterprise" is not Thomas's word.)

---

## 4. Onboarding screens — line-by-line review

Two onboarding surfaces ship today: `client/src/components/onboarding-wizard.tsx` (the modal wizard, 900 lines) and `client/src/pages/onboarding-wizard.tsx` (the page version). Per the user-memory note (`project_onboarding_state.md`), the canonical surface is `components/onboarding/OnboardingWizard.tsx`. The wizard copy is the **single biggest voice-leak inside the auth wall** — it greets every new customer with text written in a different register than the page they just signed up from.

Each step is reviewed below as **before → after**. Line refs are `components/onboarding-wizard.tsx`.

### 4.1 Step 0 — Welcome / role select

- `:142` title `"Welcome"` → `"Welcome — let's get the workspace right."`
- `:143` desc `"Tell us about your business so we can customize your experience."` → `"Two questions, then we build your workspace around them."` ("Customize your experience" is the most SaaS sentence ever written.)
- `:446` Label `"Organization Name"` → `"Your company name"` (Title Case fix per Mira §4.2)
- `:451` Placeholder `"My Real Estate Company"` → `"Norton Land Co."` (vocabulary leak per user memory)
- `:459` Helper `"We'll customize your workspace, templates, and campaigns to match your strategy."` → `"Different strategies need different templates. Pick the closest match — you can change it later."`
- `:90–96` `INVESTOR_TYPES` chip labels (`Land Flipper`, `Note Investor`, etc.) → all sentence-case
- `:95` `note_investor.description` `"Seller-finance real estate sales and collect payments."` → `"Seller-finance land sales and collect payments."` (Asher §9 / Mira §4.8)
- **Decision needed:** the `INVESTOR_TYPES` array includes residential wholesaler / fix-and-flip / buy-and-hold / commercial — categories that contradict v6 "Land Investors" framing. If Land Investors only, reduce to three: land flipper / note investor / hybrid.

### 4.2 Step 1 — Role-specific first steps

- `:149` title `"Your First Steps"` → `"Your first three steps"`
- `:150` desc `"Personalized actions based on your business type."` → `"The three things that move the needle in your first week."`
- `:498` body `"Here are the 3 best first steps for a Land Flipper. Complete them now or come back later."` → `"For a land flipper, these three pay back the fastest. Do them now or come back tonight."`
- `:107–114` Step labels (`Set Up ACH Payments`, `Import Existing Notes`, etc.) → all sentence-case
- `:122` `Add Your First Deal` → `Add a deal` (Mira's "Your First" pattern is banned)
- `:529` Skip `"Do this later"` → keep (excellent)

### 4.3 Step 2 — Add property

- `:156` title `"Add Property"` → `"Add your first parcel"`
- `:157` desc `"Add your first property to track."` → `"Drop an APN, an address, or a coordinate. Atlas pulls comps tonight."`
- `:543` body `"Add your first property to start tracking your deals."` → delete (new desc carries it)
- `:548` Label `"Property Address"` → `"Address"`
- `:553` Placeholder `"123 Main St or Tract 5 FM 2222"` → keep (the FM-road example is excellent)

### 4.4 Step 3 — Connect integrations

- `:163` title `"Connect Integrations"` → `"Plug in your channels"`
- `:164` desc `"Set up your communication channels."` → `"You don't have to do all three. Pick the ones you'll actually use this month."`
- `:186` Email desc `"Send personalized emails to leads"` → `"Send mail from your domain — replies route into Pax."`
- `:194` SMS desc `"Text message campaigns and reminders"` → `"Texts and reply-handling, with TCPA guardrails on by default."`
- `:202` Direct mail desc `"Physical mail campaigns via Lob"` → `"Letters and postcards, mailed for you. Tracked end-to-end."`

### 4.5 Step 4 — Create campaign

- `:170` title `"Create Campaign"` → `"Your first campaign — already drafted"`
- `:171` desc `"Set up your first marketing campaign."` → `"We built two starter campaigns based on your strategy. Open them, edit, send when you're ready."`
- `:671–677` Per-strategy descriptions (`X templates ready` shape — clinical) → `Two acquisition mailers, ready to send.` / `Payment reminders that don't sound like a bank.`
- `:694` `Create Sequence` → `Build a sequence`
- `:696` desc `"Set up automated follow-up sequences"` → `"Drip a lead through ten touches without reminding yourself ten times."`

### 4.6 Step 5 — Complete

- `:178` desc `"You're all set to start growing your land-investing business!"` → `"The workspace is yours. Atlas, Pax, and Sophie are awake."` (kills exclamation per Mira §4.6 + cliché)
- `:718` headline `"You're All Set!"` → `"You're set up."`
- `:719` body `"Your AcreOS account is ready. Start finding and closing deals. Your workspace has been tailored for [Land Flipper]."` → `"Workspace built for a land flipper. Atlas is comping your first three counties tonight, Pax is staffing your inbox, Sophie's ledger is empty and ready."`
- `:751` CTA `"Go to Dashboard"` → `"Open AcreOS"`
- `:309` Toast `"Templates created!"` → `"Templates created."` (exclamation)
- `:330` Toast `"Property added!"` → `"Parcel added."` (exclamation + vocabulary)
- `:360` Toast `"Welcome aboard!"` / `"Your account is set up and ready to go."` → `"Welcome aboard."` / `"Email me at thomas@acreos.io if anything's off — I read every one."`

### 4.7 Onboarding-wizard verdict

The wizard is **the single highest-leverage rewrite in this document**. Every paying customer reads it once. Right now it teaches them: *"AcreOS uses Title Case, exclamations, and the word 'tailored.'"* That is the lesson they bring into every empty state, toast, and email afterwards. Rewrite the six step descriptions and the ~20 string sites in §4.1–4.6 and the auth-wall voice-break starts to close from inside out.

Estimated work: 3 hours of writing, 2 hours of QA. Ship in a single PR.

---

## 5. Email lifecycle templates — exist? quality?

There are **two completely different email systems**, neither talking to the other:

### 5.1 The good one — `content/emails/onboarding-sequence.md` (177 lines, signed `— Thomas`)

A 7-email sequence: Welcome (Day 0), Import Leads (Day 2), First Campaign (Day 4), Social Proof (Day 7), Features You Haven't Tried (Day 10), Trial Ending (Day 12), Trial Ended (Day 14). Voice is right. Day 7's three case studies (`The Deal Feed finder / The compliance saver / The time saver`) are concrete and falsifiable. Day 14's *"reply to this email. I'll give you a straight answer"* is the brand.

**Issues:**
- **Not wired.** This is a Markdown file, not a shipping program. Verify a `server/jobs/` cron reads it; if not, it's a doc.
- **Trial-duration mismatch.** Day 0 says `"90 days of full Pro access"` but Day 12 is "Your trial ends in 2 days" (implying 14 days). Header says "14-Day Trial." The same prospect sees both numbers. Pick one and fix the ~12 places it appears (FAQ, pricing footer, FinalCTA, `pricing.tsx:127`).
- **"AI" leaks** in Day 4 (`"the AI will draft"`, `"The AI-generated copy"`). Per Mira §6 / Asher §3.1, rewrite as `Pax drafts a message in your voice`.
- **Day 14 prices wrong.** Lists `Free / Starter ($20) / Pro ($49)` — the prosumer model. If we commit to operator pricing (§3), needs Solo/Operator/Operation.

### 5.2 The bad one — `server/services/emailService.ts:609–804` (six built-in HTML templates)

Six templates: `verification`, `passwordReset`, `notification`, `welcome`, `alert`, `founderBriefing`, `churnRescue`. The first five are not in voice and look nothing like the brand:

- **Welcome** (`:677`) — `<h1>Welcome to AcreOS!</h1>` (exclamation), gradient `#11998e → #38ef7d` (random teal/green, no relationship to homestead palette), body `"Thank you for joining us! We're excited to help you manage your land investments."` (two exclamations, corporate). This is the first thing every paying customer receives, written by a different person than the Markdown Day-0.
- **Verification** (`:609`) — gradient `#667eea → #764ba2` (purple SaaS circa 2018), `"Please verify your email"` ("Please" banned, Mira §4.4).
- **Password reset** (`:632`) — gradient `#f093fb → #f5576c` (pink). Same shape, same problems.
- **Notification + Alert** (`:655`, `:706`) — content is caller-controlled (`data.title`/`data.message`), so voice consistency is impossible.
- **Founder briefing + Churn rescue** (`:736`, `:781`) — chrome is correct (`-apple-system`, AcreOS gradient). Body of churn rescue is caller-controlled.

### 5.3 Email lifecycle gaps

Audit summary of what exists:

- **Wrong chrome + voice, but exist:** verification, password reset, welcome (built-in HTML).
- **Good text, not wired to a sender (verify cron):** Day 0, 2, 4, 7, 10, 12, 14 (Markdown sequence).
- **Don't exist:** dormant 30, dormant 60+, win-back at 30 days post-cancel (the FAQ promises this — `"we'll send you a personal email asking what we missed"`), payment failure / dunning in voice (Asher §10: `"Your card was declined. Nothing changed on your account. We'll retry in 3 days, or you can update the card now."`).
- **Half-built:** churn rescue (chrome OK, body caller-dependent), plan-change confirmation (unaudited).

### 5.4 The single biggest email recommendation

**Replace `emailService.ts:buildWelcomeTemplate` with a render of the Markdown sequence's Day 0.** That one move makes the welcome email read like the landing page that sold the customer. Same for verification (rewrite once in voice) and password-reset (rewrite once in voice). Three templates, one afternoon, the email lifecycle stops contradicting the brand.

---

## 6. In-app help + tooltips — gaps

### 6.1 What exists

`components/help-tooltip.tsx` defines **10 help topics**: `land-credit-score`, `70-percent-rule`, `dodd-frank`, `composite-score`, `cap-rate`, `arv`, `seller-finance-yield`, `byok`, `tcpa`. Copy is encyclopedic but on-voice (`"like a credit score for dirt"`). `components/help-content.tsx` is the help index — six feature cards. `pages/help.tsx` is the rendering surface.

### 6.2 What's missing

**Tooltip coverage ~5% of surfaces that need it.** Untooltipped terms surfaced in the product: `Pulse score`, `Buy-box`, `Skip-trace`, `APN`, `Confidence band`, `Atlas comp / Pax draft / Sophie servicing`, `Stage`, `Autonomy slider`, `Suggest / Review-then-send / Auto-send`, `Note servicing`, `Borrower`, `1098`, `Provenance`, `Audit log`, `Disposition`, `Comp markup`, `Mailer drop`, `Pax inbox`, `Sequence`, `Reply rate`, `Trial`, `Seat`, `Operator / Operation tier`. Of ~30 terms, two have tooltips.

**Help index lists 6 features; product has ~14.** Missing: Pax inbox, Sequences, Note servicing, BYOK config, Audit log, Reports, Founder dashboard, Settings/Roles.

**Help has no search.** A customer who knows the term ("balloon payment") can't find it.

### 6.3 Tooltip voice rule

Every tooltip = **two sentences**: one defining, one telling the customer how AcreOS uses it. Example from `composite-score`: *"A weighted blend of 4 scores: parcel quality (30%), owner motivation (30%), county opportunity (20%), and land credit (20%). Scores above 80 are strong acquisition candidates."* Definition-only tooltips read like a glossary; the customer wants to know *what AcreOS does with it*.

### 6.4 Help-content.tsx voice issue

`:88` `"AI Agents"` (Title Case + banned word). `:93` bullet `"AI-generated property descriptions and marketing copy"` → `"Property descriptions Pax drafts in your voice."`

---

## 7. Voice guidelines — for long-form copy (extending Mira)

Mira codified microcopy. These are the additional rules that govern anything **over 30 words**: emails, founder letters, feature descriptions, help articles, app-store copy, support replies.

### 7.1 The seven rules of long-form voice

1. **Open with a sentence that could be spoken across a kitchen table.** Not "We're excited to announce." Open with the specific thing: *"Your Deal Feed has been scanning your target counties for 2 days now."*
2. **Use a number every paragraph or two.** Specifics are the credibility — `200 land deals`, `$1.4M closed`, `4 hours per parcel to 15 minutes`. Generic claims (`"helps investors save time"`) are the texture of a deck.
3. **Name a thing the reader can verify.** Counties, vendors, FM road numbers, specific competitors. *"PropStream in one tab, Pebble in another"* is the voice. *"Various tools and platforms"* is corporate beige.
4. **One contraction per sentence, minimum.** The absence of contractions reads like a contract.
5. **Compound sentences are allowed — but only when the structure earns the rhythm.** The 38-word sentence that opens `/why` works because it stacks specifics. The compound sentence with *no* specifics (`"Our platform helps you streamline your operation by integrating multiple tools"`) is banned.
6. **Sign with a name, not a logo.** Every email `— Thomas`. The brand is a person; act like it.
7. **End on the specific, not the inspirational.** Bad: *"We're excited to grow with you."* Good (FAQ): *"We don't hold your data hostage — and we'll send you a personal email asking what we missed."* Last impression = falsifiable promise.

### 7.2 Banned constructions in long-form (extends Mira's banned-word list)

`"We're excited to announce"`, `"In today's fast-paced world"`, `"Whether you're A or B,"`, `"Empower"` / `"Streamline"` / `"Leverage"` / `"Solution"` / `"Platform"` (when describing AcreOS) / `"Suite"` / `"Robust"` / `"Best-in-class"` / `"Cutting-edge"` / `"Seamlessly"` / `"Game-changing"`, `"Enterprise"` (use `operation`), `"AI"` (customer surfaces), `"Real estate"` (product chrome).

### 7.3 Long-form templates (drop into `content/emails/`)

Three templates the lifecycle is missing. Each one signed `— Thomas`. Subject + body.

**Cancellation follow-up** — *Subject: Why'd you leave?* / *Hey [first], I saw you cancelled AcreOS this week. Quick question: what was missing? I read every reply to this email. Even if the answer is "I just didn't use it" — that tells me something. Your data is still there. If you ever want it back, hit reply.*

**Dormant 30 days** — *Subject: Everything OK?* / *Hey [first], noticed you haven't logged in for a few weeks. No pitch — just checking. If you're stuck on something, hit reply. If life got in the way, no problem. Atlas, Pax, and Sophie are still doing the background work. Your data is current.*

**Payment failure (dunning #1)** — *Subject: Card declined — nothing changed on your account* / *Your card on file was declined this morning. Nothing changed yet — your seats, agents, and data are all intact. We'll try again in three days. Or you can update the card now: [link]. If something's gone sideways on your end, reply — we'll work around it.*

---

## 8. The 1-week copywriting sprint — top-15 surfaces to ship

Priority order. Each is a discrete deliverable. Total ~3 days of writing for one person; whole sprint fits in one calendar week with QA.

1. **Resolve the pricing-page split** — pick operator or prosumer; rewrite the loser. `pages/pricing.tsx`, `pages/landing/Pricing.tsx`. 4h writing + decision call. Highest-leverage narrative move (Asher §4 + my §3).
2. **Rewrite the onboarding wizard** — steps 0–5 titles, descriptions, completion screen, three toasts. `components/onboarding-wizard.tsx`. 3h. Every paying customer reads this; it teaches the in-product voice.
3. **Rewrite welcome / verification / password-reset emails** — match the Markdown Day-0 voice and homestead palette. `server/services/emailService.ts:609–704`. 3h. First three emails every customer receives.
4. **Wire the Markdown onboarding sequence** — verify cron, fix 90-day vs 14-day mismatch, kill "AI" mentions. `content/emails/onboarding-sequence.md` + sender. 4h.
5. **Write the three missing lifecycle emails** — cancellation follow-up, dormant 30, dunning #1. `content/emails/`. 3h. The FAQ already promises the cancellation email.
6. **Rewrite three Features cards** — Mail platform, E-sign + escrow, Automation builder. `pages/landing/Features.tsx`. 1h. Pulls Features from 3.5 → 5/5.
7. **Decide landing FounderNote vs `/why`** — consolidate or differentiate; rewrite the loser. 2h writing + decision.
8. **Write 20 missing tooltip topics** — Buy-box, APN, Skip-trace, Pulse score, Confidence band, Stage, Pax draft, Autonomy slider, Sequence, Sophie ledger, Audit log, Borrower, 1098, Operator/Operation tier, Mailer drop, Trial, Seat, BYOK detail, Reply rate, Disposition. `components/help-tooltip.tsx`. 4h.
9. **Verify or kill landing testimonials.** 1h decision + 30min.
10. **Sentence-case sweep on app dialog titles + buttons** (Mira §4.2). 8 files, 2h.
11. **Kill "AI" on customer surfaces** — `today.tsx`, `pricing.tsx:64`, `help-content.tsx:93`, onboarding emails Day 4. 6 files, 1h.
12. **Replace `Welcome aboard!` and three more exclamations** (Mira §4.6). 30min. Smallest fix, biggest tone delta.
13. **Vocabulary sweep — "real estate" → "land"** in onboarding chip, persona-panel, market-data title, privacy line. 4 files, 30min.
14. **Maintenance / 5xx page in voice** — write `pages/maintenance.tsx` in Asher §10's voice (`"Something broke. We see it. The team is on it. If you have a deal closing today, email thomas@acreos.io and we'll work around it."`); link it from status page footer. 1.5h.
15. **App-store metadata for Capacitor build** — `appName: "AcreOS"` is set; description, keywords, category, screenshots metadata aren't. Write App Store + Play Store listings in voice. 1.5h.

### 8.1 What's deliberately not in the top 15

- A blog. AcreOS does not need a blog yet — the landing + `/why` + a curated changelog do the job a blog would do at this stage.
- A press kit. Skip until a real launch event.
- Tooltip search / a full Help redesign. Out of scope for one week; flag for next quarter.
- The `Day in life` Before/After deep-read. Worth doing — but only after the in-product voice is consistent enough that the After column can credibly point at the product.

---

## 9. Voice scorecard (long-form surfaces — extends Mira)

| Surface | Voice | Notes |
|---|---|---|
| Landing hero / Agents / FAQ / Final CTA | 5 / 5 / 5 / 4.5 | Brand-defining; ship as-is |
| Landing How it works | 4.5 | Step-2 rhythm tweak |
| Landing Features | 3.5 | 3 of 12 cards drag the score |
| Landing FounderNote | 4 | Competes with `/why` |
| `/why` letter | 4.5 | Slightly short; could add the "click moment" |
| `/pricing` page | 2 | Wrong tier model + generic copy |
| Onboarding wizard | 2 | Single biggest in-app debt |
| Email — Markdown sequence | 4.5 | Great text; "AI" leak; 90-day vs 14-day mismatch; not wired |
| Email — built-in HTML (verification/password/welcome) | 1.5 | Different writer, palette, planet |
| Email — founder briefing | 4 | Good chrome, voice depends on caller |
| Email — churn rescue | 3.5 | Chrome correct, body caller-dependent |
| Status page | 4 | Solid; missing the "when it's broken" voice carry |
| Maintenance / 5xx page | — | **Doesn't exist** — biggest single voice gap |
| App-store listing | — | **Doesn't exist** — write before next mobile build |
| In-app help index | 3.5 | Six features when product has ~14 |
| Help tooltips (10 ship) | 4.5 | Voice right; coverage ~5% |
| Support reply templates | — | **Don't exist** — flag for separate sprint |
| **Composite, long-form** | **3.6** | Public ~4.6, in-product ~2.5. The auth wall is where the voice dies. |

---

## 10. Closing note

The hard work is already done. There is a real voice on this product, written by a real person, and most of the work in this audit is **propagation, not invention.** A pricing decision, a wizard rewrite, three emails, a status-page footer, and a 20-tooltip backfill — and AcreOS becomes the one piece of land-investing software a customer can read end-to-end and feel they were spoken to by the same person. That is rarer than it sounds. The week's worth of writing pays back forever.

The single most important sentence in this document is the one buried in the FAQ: *"We don't hold your data hostage — and we'll send you a personal email asking what we missed."* When the cancellation flow ships that email, in voice, signed `— Thomas`, AcreOS will have the screenshot moment that no SaaS in this category currently owns. That is the brand.

— Eden Volkov · 2026-05-01
