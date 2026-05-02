# Brindley Oakes — AcreOS audit (newsletter + YouTube affiliate review)

I'm 38. I run **Acre Letter** — a 50,000-subscriber Land Investing newsletter that sends Tuesday mornings — and a YouTube channel sitting at 8,200 subs. My business model is the boring one: 80% of my revenue is affiliate. Skip-trace tools, mailing-house referrals, county-data subscriptions, GIS plug-ins, the whole stack a Land Investor pays for. I take the call, I cut the deal, I mention it once a quarter, I get a check.

I'm here because three of my readers in the last six weeks have asked me, unprompted, "do you have an AcreOS link?" That's a tell. When the question comes from the audience before the pitch comes from the vendor, the product is moving on its own. So I came in cold to evaluate: **would I promote AcreOS to my list, and is the program built to actually pay me?**

I'm going to tell you up front: the product is good enough that I want to. The affiliate program is not built. Below is what I found and what would have to be true for me to push send on a Tuesday email to 50K people.

---

## 1. Thirty-second verdict

**Product**: would promote. The land-vertical specificity is the wedge. Nobody in my niche has anything this consolidated, and my readers are already asking for it.

**Affiliate program as it exists today**: would not promote. There is **no affiliate program**. There is a *referral* program — user-to-user, $1 in credit on a converted deal, capped at "free month of Pro." That's not affiliate infrastructure. That's a viral-loop primitive that wasn't designed for someone whose audience is 50K large and whose median promotion is worth $20–80K in lifetime contract value to the vendor.

If AcreOS wants my channel, the gap is roughly **eight weeks of platform work** plus a real signed agreement. Below is what's missing and what it has to look like.

---

## 2. What's actually in the codebase right now

I read the implementation. Two files own this:

- `/Users/user/AcreOS/AcreOS/server/routes-referral.ts` — five endpoints
- `/Users/user/AcreOS/AcreOS/content/marketing/referral-copy.md` — the user-facing copy
- `/Users/user/AcreOS/AcreOS/shared/models/auth.ts` — the `referrals` table

What it does:

1. Every user gets an 8-character referral code on demand (`/api/referral/code`).
2. New signups can pass `?ref=CODE` and `/api/referral/apply` links them to the referrer.
3. When the referee hits "deal_won" the first time, `/api/referral/activate` flips status to `converted` and credits **100 cents** to both orgs' `referral_credits` column.
4. Referrer can see signups + conversions count via `/api/referral/stats`.

That is the entire system. There are exactly **three states**: `pending`, `signed_up`, `converted`. There is no commission. There is no payout. There is no link tracker beyond a query parameter. There is no cookie. There is no UTM mapping. The "reward" is one dollar (literally `creditAmount = 100` cents) which the user-facing copy upgrades to "a free month of Pro" without any plan-tier logic to back it.

Three concrete bugs/gaps I noticed in passing — not the focus of this audit but the founder should know:

- `routes-referral.ts:165` writes `convertedAt` to the `referrals` row, but `auth.ts:159` defines the column as `creditedAt`. The activation endpoint silently fails to persist the timestamp via Drizzle's typing — TypeScript would catch this if `(req as any)` weren't masking the user lookup three lines above. Read at it again.
- `routes-referral.ts:23` — `(req.user as any)?.id` violates the project's own `CLAUDE.md` rule about `AuthenticatedRequest`. Five endpoints in this file do it.
- The reward credit (`100` cents) is hardcoded, with a comment saying "or 1 month free depending on plan" — the plan branch was never written.

That's the floor. Now here's what an actual affiliate program needs.

---

## 3. The seven things I need before I send a Tuesday email

### **(1) Commission rates that are worth my reputation.**

I'm not promoting AcreOS for $1 of credit. My audience knows what my recommendations are worth and they know I get paid. That's fine — it's the contract. What's not fine is pretending it's a friends-and-family viral loop when a creator is involved.

What I need: **30% recurring on the referred org's MRR for 12 months**, OR **50% one-time on first-year contract value**, my choice per partner. That's industry-standard SaaS-affiliate terms (ConvertKit, Webflow, Podia all sit in this band). Land vertical is small enough that I'd take 30% recurring because LTV in this niche is high — Land Investors don't churn the way ecom does. They use the tool until they die or stop investing.

What's there: 100 cents. One dollar. Per signup that closes a deal. There is no rate structure, there is no tier-aware mapping, there is no recurring-vs-one-time toggle. The `creditAmount` field exists on the `referrals` row so the table shape can hold it, but everything else is missing.

### **(2) Attribution window + cookie + UTM that actually works.**

My readers don't sign up the day they read the email. They read it, save the email, sit on it three weeks, watch one of my YouTube videos, click that link, and *then* sign up. If your attribution is "the user typed `?ref=CODE` into the signup URL and we caught it in the same session," you will lose 70% of the conversions I drive.

What I need:
- **First-click cookie, 60-day window, persisted client-side** (`acreos_ref` cookie set on `acreos.com` and `app.acreos.com`, signed, domain-scoped, SameSite=Lax). 60 days is the floor for B2B SaaS in 2026; 90 is better.
- **UTM parameters honored separately** — `utm_source=acreletter&utm_campaign=tuesday-2026-05-01&utm_content=v1` should resolve to my affiliate ID via a partner-mapping table, so I don't have to retrain my list to use a new link format.
- **Cross-device attribution** via email-address fallback — if the same email shows up on a YouTube-clicked device that didn't have the cookie, but a previous click *did* land the cookie on a different device, the click-on-other-device wins. Industry calls this "deterministic + probabilistic stitch." I don't expect probabilistic, but deterministic via verified email is table-stakes.
- **Clear tie-break rule**, written down: first-click wins over last-click, with a 60-day window, and a documented exception list (users who self-attribute via "how did you hear about us" override the cookie).

What's there: a query-string parameter, no cookie, no UTM mapping, no window (technically infinite — the row sits there forever until someone closes a deal), no cross-device anything. The `?ref=CODE` lookup happens *only* if `/api/referral/apply` is called from the signup flow with a `refereeId` already in hand, which means it depends on whoever wired the signup page to remember the parameter through OAuth/Clerk redirects. I'd bet money 30% of intended attributions silently drop on the Clerk redirect today.

### **(3) Payment frequency and 1099 plumbing.**

I have a CPA. He charges by the receipt. If AcreOS pays me in "free months of Pro credit on my own org," I cannot cash that. I do not need a CRM. I need a check.

What I need:
- **Monthly payouts** via Stripe Connect or PayPal, partner picks. Net-30 from the close of the calendar month. Minimum payout threshold $50 (carry forward below that).
- **W-9 collection at affiliate signup**, automatic 1099-NEC issuance in January for any partner over the $600 threshold. Stripe Connect handles this natively if you wire it correctly. I will not provide a tax ID twice.
- **Backup withholding flow** for partners who don't return a W-9 in 30 days.
- **Statement page** in the partner dashboard showing every conversion, the commission earned, the date payable, the date paid, the Stripe transfer ID. CSV export. My CPA reads CSVs.

What's there: zero. The reward is a `referral_credits` integer column on the org. There's no Stripe Connect, no payout schedule, no tax form, no statement. I checked: there's a `commissionService.ts` for *internal* AcreOS sales-rep commissions (the platform pays its own reps), and that's nice, but it's a different system that doesn't touch referrals.

### **(4) Refund / clawback policy I can plan around.**

If someone signs up through my link, I get paid the commission, and then they refund 45 days later — I expect a clawback. That's fair. What's not fair is: surprise clawbacks 8 months later, indefinite clawback windows, or clawbacks that exceed the commission I was paid (i.e. dipping into future commissions to cover a loss).

What I need, written into the partner agreement:
- **90-day clawback window** from initial commission. After day 90, the commission is final.
- **Pro-rated clawback** for partial refunds. If the customer churns at month 4 of a 12-month commission stream, future months stop. Months 1–4 already paid stay paid.
- **No cross-account clawback.** If partner A's referral refunds, you do not deduct from partner A's *next* referral's commission. You charge the clawback against the open balance, and if there's no open balance, it's the vendor's loss.
- **Visible in the dashboard.** Every clawback shows in the statement with the original commission line item linked.

What's there: nothing. There is no refund flow at all in this codebase that I could find — the `referrals.status` only goes forward (`pending → signed_up → converted`), with no `refunded` or `clawed_back` states. If a referee charges back tomorrow, the referrer keeps their $1 of credit and AcreOS eats it. Currently this works because the credit is $1. The first time the credit is $5,000, the founder has to write all of this in production under pressure.

### **(5) Product-quality threshold (am I willing to put my name on it).**

This is the part I cannot delegate. I have spent 11 years building trust with my list. One bad recommendation and I lose subscribers I'll never get back. So before I send the email, I run my own audit. I did.

The product is **good but not stable enough yet** for a 50K-list send. Specifically:

- **The land-vertical specificity is real.** Skip-trace, county data, GIS, due diligence, deal pipeline, seller-financed notes, comp pulling — it's all here and it's all aware that the asset class is *land*, not houses. That's the thing nobody else has.
- **The founder-AI surfaces (Sophie / Forge / Atlas) are intrusive in v1.** A new user signing up through my link is going to land in an interface that's still partially talking to the founder and not to them. I read the persona-architecture memo — the design intent is that customers see Pax only — but the seams are visible. I clicked into three founder-flavored surfaces in 20 minutes of evaluation. That's two too many. Fix this before I send. Hard rule.
- **The onboarding wizard is solid** — saw `OnboardingWizard.tsx`, the org-scoped state model, the goals fieldset. Works.
- **No demo / sandbox mode.** I cannot do a YouTube walkthrough video without exposing real data or fabricating an org by hand. Nadege's audit (same date, this folder) called this out and I'm seconding it. For a creator promoting the platform, sandbox mode is a *requirement*, not a nice-to-have. I will record once and the video lives forever — it cannot have a real APN visible at minute 4:32.
- **Pricing page accessible from outside without login.** I checked — I'm not going to drive traffic to a SaaS that hides pricing. Land Investors are price-conscious and the conversion drop-off from "click affiliate link → bounce because no pricing visible" is brutal.

I would promote at v1.1 — say, after sandbox mode and the founder-surface scrub ship. Not today.

### **(6) Education materials AcreOS gives affiliates.**

The vendors I currently promote send me three things, every quarter, without me asking:
1. **A 30-minute screencast walkthrough** of new features, recorded by their PM, that I can clip into my own videos with attribution.
2. **Three pre-written email blocks** — one short (50 words), one medium (200), one long (600) — with merge tags for my affiliate link. I rewrite them in my voice but the structure saves me 90 minutes of work per send.
3. **A swipe file of social posts** for X, LinkedIn, and short-form video hooks.

What AcreOS has: the `referral-copy.md` file. It has Twitter/Facebook/DM copy aimed at *user-to-user* sharing — "I've been using this tool, if you sign up we both get a free month." That copy doesn't work for me. My audience knows me as the affiliate guy. I cannot write "we both get a free month" because (a) I'm not getting a free month, I'm getting a check, and (b) my audience would feel patronized.

What I'd want shipped:
- A **partner asset library** at a stable URL (`acreos.com/partners/assets/`) with PNG/SVG logos in 4 sizes, PDF one-pagers, three pre-written email templates per use-case (general intro / upgrade pitch / vertical-specific hook), 5 short-form video clips under 60 seconds licensed for repost.
- **A monthly partner email** with what shipped, what's coming, hook angles. Five-minute read.
- **A private Slack or Discord** for partners >10 conversions/quarter. Not a Circle community — I have enough of those — a low-traffic operator channel with a PM who actually answers.

This is the cheapest thing on this list to build and the highest-leverage. A creator-affiliate program lives or dies on whether the vendor makes me look good without me doing extra work.

### **(7) An actual affiliate dashboard distinct from referral stats.**

`/api/referral/stats` returns four integers: signups, conversions, creditsEarned, creditBalance. That is a referral dashboard for a user. It is not a partner dashboard.

What I need:
- **Real-time link-click count** broken down by UTM (so I can A/B test subject lines without writing my own analytics).
- **Funnel view**: clicks → signups → trials-started → trials-converted → 30-day-retained → commissioned.
- **Per-campaign breakdown** so a Tuesday email doesn't get aggregated with my YouTube comments.
- **Open commission balance**, next payout date, last 12 statements.
- **Partner-tier indicator** (more on this below).
- **API access** with a personal token. I script my dashboards into Notion. I am not logging in to check stats.

This is maybe 40 hours of frontend + 20 hours of backend, sitting on top of analytics and payment infrastructure that has to exist first.

---

## 4. Partner tiering — the lever AcreOS isn't pulling

Right now there's one referral type: a user. Every user gets the same code, same reward, same dashboard. That's wrong for a creator economy.

Three tiers, real terms:

**Tier 1 — Customer referrals**: existing users sharing with friends. Keep the current flow. $1 credit / one free month, both sides. This is what's built (almost). Keep it.

**Tier 2 — Verified affiliates**: anyone with >5 conversions/year or >1,000 audience members. 30% recurring for 12 months. Stripe Connect payout. W-9 on file. Access to the asset library. This is where Brindley sits at signup.

**Tier 3 — Strategic partners**: top 10 creators in the niche. Custom terms — co-marketing budget, dedicated PM, early-access betas, revenue share on bundled cohorts (cf. Nadege's audit on white-label cohorts). Probably 6 partners total in the Land vertical exist; you can pick them off in a quarter if you build T1 + T2 well.

The current product is shaped to support all three but built for none. The data model — `referrals` table with `status` and `creditAmount` — could carry tier and rate columns with a one-day migration. The auth model already has org-scoping. The hard part is everything *outside* that table: payments, tax, attribution, dashboard, agreement.

---

## 5. The honest answer to "would you promote it"

Today: **no**. The reward is too small, the attribution is too brittle, there's no payout rail, and I can't record a demo without leaking real data.

After one quarter of work — sandbox mode, real affiliate program with Stripe Connect payouts and 60-day cookie attribution, partner asset library, founder-surface scrub: **yes**, and I would put it in front of 50K Land Investors on a Tuesday. My estimate of the inbound: 800–1,200 clicks, 80–120 signups, 30–50 closed deals over 90 days. At $79/mo Pro pricing and a 30% commission, that's $700–$1,200/month recurring to me for 12 months — and AcreOS keeps 70% of LTV on customers who would not have found it otherwise. That's the deal that works for both of us.

The product is closer to ready than the program is. Build the program.

— Brindley
