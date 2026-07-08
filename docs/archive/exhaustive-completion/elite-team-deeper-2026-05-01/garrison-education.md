# Garrison Fox — Bundling AcreOS into a Land-Investing Course Business

**Persona:** Garrison Fox, 50, Nashville. Founder of "Acres & Equity," a Land Investing education company. 4,500 active students, 12 staff, 7 coaches. Course on Kajabi, community on Skool, payments on Stripe, affiliate program on FirstPromoter, support on Help Scout.
**Volume of decision:** 4,500 students, ~1,800 of them active in any given quarter; ~600 of those are doing real deals; ~120 are actively asking me "what software should I buy?" every week. That's the question I want to stop answering.
**Wave 3 audit. 2026-05-01.**

I am not an AcreOS user. I'm a potential **reseller**. I sell the *education* (12-week cohort + lifetime access + monthly group calls). My students need an OS to actually operate after week 4. Right now I send them to Pebble, REISift, and a Google Sheets template I cobbled together in 2019. Half of them never set anything up. Half of those who do, churn before deal #1. **My completion rate would jump from 23% to 45% if there were a single button at week-4 graduation that said "Set up your AcreOS account, pre-loaded with the 3 counties and 12 templates from this course."** That button is what I'm looking for.

Read Wendell's note (operator at 60 deals/yr), Cyrus's note (1,200 deals/yr power user), Penelope's note (10-person team, RBAC). None of them is me. **I'm the upstream funnel.** If AcreOS partners with me, every one of the 4,500 names on my roster becomes a warm AcreOS lead. If AcreOS doesn't, I'll evaluate three competitors over Q3.

---

## 1. Thirty-second verdict

The reseller rails exist. They are not finished. **`whiteLabelService.ts` and `routes-white-label.ts` are real** — tenant CRUD, custom domain resolution, feature flags, branding, revenue-share JSON, plan tiering. The schema (`whiteLabelConfigs` in `shared/schema.ts:258-284`) has every column I'd want, including `customDomain` (UNIQUE), `primaryColor`, `accentColor`, `logoUrl`, and a `revenueShare` JSON `{ platformFeePercent, resellerFeePercent }`. Default split in code is **70/30 to AcreOS/reseller** (`whiteLabelService.ts:127`). That's the wrong way around for a course business with 4,500 names; I'd negotiate 50/50 minimum and walk if it's not on the table.

What's missing — and missing in ways that matter for me, not for the eventual enterprise customer:
1. **Zero course-platform webhooks.** I grep'd for "kajabi," "teachable," "learndash," "thinkific," "podia," "skool" across the entire repo. Zero hits in `routes-integrations.ts` (1,732 lines), `webhookHandlers.ts` (752 lines), or schema. The handoff from "student finished module 4" → "AcreOS account provisioned" doesn't exist. I'd build it, or pay AcreOS to build it.
2. **The internal `courses` / `courseEnrollments` / `tutorSessions` tables (`shared/schema.ts:9826-9955`) are an *AcreOS Academy*, not a *Garrison Academy.*** AcreOS is building its own education product, which directly competes with mine. **This is the strategic question I need answered before signing.** Either (a) Academy is for free in-app workflow education only, never sold as a course, or (b) it's a content marketplace and I'm a publisher there, or (c) it's a competitor and I should find a different OS.
3. **No education-tier pricing.** `Pricing.tsx:18-67` lists Solo $199 / Operator $499 / Operation $1,290. **No student tier. No cohort tier. No "bundled with course" SKU.** The closest is Solo at $199, which is fine for the student but leaves no margin for me as reseller.
4. **`getResellerReport` returns hardcoded `totalRevenue: 0`** (`whiteLabelService.ts:246`). The comment says "Would be calculated from Stripe in production." This is the metric I will obsess over daily once I'm reselling. It cannot be a placeholder.
5. **`reseller-dashboard.tsx` is 807 lines and visually complete** — tenant table, MRR chart, AI credit usage, status badges. But the analytics API it consumes (`routes-white-label.ts:108-132`) returns zeros for `totalUsers`, `totalRevenue`, `mrr`, `totalAiCreditsUsed` whenever `getResellerReport` fails — which is *always* right now because Stripe Connect rollups aren't wired (`routes-white-label.ts:115-117`).

If I had to bet today: I'd run a 90-day pilot with 50 students from my November cohort. I'd want SSO from Kajabi, a webhook on lesson completion, a "Volume bundle" SKU, and a real revenue dashboard. **If the pilot retention beats my current 23% with the Sheets template, I'm in for $300K/yr in seat revenue and 4,500 names.**

---

## 2. The handoff I need — week-by-week

**Week 0** (student buys course, $1,997 on Kajabi). Kajabi sends `purchase.created` webhook. I want AcreOS to receive that webhook on `/webhooks/kajabi/{tenantId}`, verify the HMAC, and create a **pre-provisioned organization** in `pending_activation` state with the student's email, name, and a magic-link invitation. Today: that endpoint does not exist. The closest thing in the repo is the Stripe webhook (`webhookHandlers.ts`) which only knows about subscription events. I'd want a parallel `kajabi.ts` / `teachable.ts` / `skool.ts` handler module.

**Week 1** (student watches "Welcome to Land Investing"). Nothing happens in AcreOS. Account stays dormant.

**Week 4** (student finishes "Choosing Your First County" module). Kajabi fires `lesson.completed` with `lessonId = chosen-county-101`. AcreOS receives it, marks `onboarding_step_2_complete` on the org, and the student gets an email: "Your AcreOS workspace is ready — we've already loaded the 3-county sample buy-box from this lesson." **This is the moment I capture them.** Right now, in a no-AcreOS world, week-4 students go shopping for software, get overwhelmed, and disappear by week 5. The handoff has to happen *while the dopamine of finishing the lesson is still active*.

**Week 6** (student finishes "Sending Your First Mailers" module). Webhook → AcreOS auto-provisions a 100-postcard credit (paid out of *my* account, not theirs) and pre-loads my mailer template. The first 100 postcards are on me. I write off ~$62 in mailer cost as a CAC reduction; I'd otherwise spend $200 on a Facebook ad that wouldn't convert this person.

**Week 8** (first deal). Student closes their first $4K acquisition. AcreOS pings my Slack via the existing webhook integration (`routes-integrations.ts` covers Slack). I post in the cohort: "Tara just closed her first one — let's celebrate." Social proof flywheel. **This needs an AcreOS → reseller webhook for student-level events.** I don't see this surface today; reseller analytics are aggregate-only (`routes-white-label.ts:/analytics`, `/revenue-trend`).

**Week 12** (graduation). Student is now a paying AcreOS Solo customer at $199/mo. I've collected my 30% (= $60/mo per student). At 600 active students that's **$36K/mo in pure revenue share with zero cost to serve.** That's the napkin that gets me to sign.

**Year 2** (lifetime course alumnus, no longer in active cohort). They keep paying AcreOS. I keep collecting my share. **This is what I'm actually selling — recurring revenue from one-time course buyers.** The 70/30 default split in `whiteLabelService.ts` makes that math work at scale; the lower-end 50/50 ask is for when I deliver the *first 500* students to prove the model.

---

## 3. Friction list — reseller-specific

1. **No course-platform webhook handlers.** Kajabi, Teachable, Thinkific, Podia, LearnDash, Skool, Mighty Networks, Circle. Pick the top three (Kajabi, Skool, Teachable cover ~85% of land-investing educators) and ship typed webhook routes. None exist (`grep -rE 'kajabi|teachable|thinkific' server/` returns empty).
2. **No "bundled" billing tier in schema.** `whiteLabelConfigs.plan` is `starter | professional | enterprise` (`whiteLabelService.ts:60`). Nothing models "this account is owned by a reseller and the reseller pays AcreOS bulk, not the end student." For a course business I need: I prepay $99/student/mo for 500 seats, AcreOS bills *me*, students never see a Stripe page. Today the architecture assumes per-student Stripe subscriptions (`routes-billing.ts`).
3. **`revenueShare` is JSON; no enforcement code uses it.** I `grep`'d for `revenueShare` and `platformFeePercent` — defined in two places (schema + service), referenced nowhere else. The split is documentation, not money movement. Stripe Connect transfers based on this percentage are not implemented.
4. **Reseller dashboard total revenue is `0`** (`whiteLabelService.ts:246`). My dashboard shows zero MRR even after I have 200 paying tenants. This will make me lose trust in the platform fast. Wire it to `payments` / `stripeConnectTransfers` before launch.
5. **No per-tenant Stripe Connect account.** `stripeConnect.ts` exists for borrower payments (`routes-billing.ts:391`) but isn't wired into the white-label flow. To pay me my 30% I need a Connect account; the rails are there for *one* purpose and not the other.
6. **No "bulk invite" surface for reseller.** I have a CSV of 4,500 student emails. I want to drop that CSV into the reseller dashboard and have AcreOS send pre-provisioned magic links. `reseller-dashboard.tsx` (807 lines) has no CSV import — it's tenant-by-tenant via dialog. At 4,500 students I'm not clicking 4,500 dialog boxes.
7. **No "course-aware" onboarding state.** `onboarding-v2.tsx` (1,531 lines) and `onboarding-wizard.tsx` (900 lines) are both linear, generic flows. There's no concept of "skip this step, the student already learned it in week 4 of Garrison's course." Per the codebase memory, onboarding state is org-scoped (`organizations.onboarding*`). I'd want a `skipReason: 'taught-in-cohort-week-4'` flag so I can tell AcreOS "don't make my students rewatch the explainer video, they already saw it."
8. **AcreOS Academy competes with my course.** `client/src/pages/academy.tsx` (658 lines) ships with built-in courses including "Understanding MAO," "Choosing Your First County" (these are exactly my topics). The `/api/academy/courses` endpoint (`routes-academy.ts:18-30`) and the AI tutor (`routes-academy.ts:137-187`) — including a **GPT-4 system prompt that explicitly says "You are an expert real estate educator for AcreOS Academy"** — make AcreOS itself a competing education brand. **Founder needs to make an explicit promise: Academy is workflow training, not coursework. It will not be marketed as "learn land investing in AcreOS."** Otherwise I'm sending my students into a funnel that competes with mine.
9. **Tutor sessions cost org credits, not reseller credits.** `routes-academy.ts:144` debits 2 credits per AI tutor message from the *student's org*. If I'm prepaying for 500 student seats, I need an option to fund the tutor pool from my reseller credit balance, not theirs. Otherwise students hit the 402 wall and call me, not AcreOS support.
10. **No co-branded login screen.** Custom domain resolution exists (`whiteLabelService.ts:192-196`, `customDomainRouter.ts`), but I haven't seen the **Clerk-side** integration for showing my logo on the auth screen. Clerk is the auth provider per the infra memory. Need a `clerk.dev/branding` configuration per tenant — either via Clerk Organizations API or by routing students through a tenant-specific Clerk instance.
11. **No affiliate-link tracking for non-white-label flow.** Some students will click my affiliate link without going through full white-label provisioning. I want a `?ref=garrison-fox` URL parameter that drops a cookie, attributes the eventual signup to me, and pays out via Stripe Connect. The promo code system exists (`routes-billing.ts:306-321` reads `pricingCfg.stripeCouponId`). I'd add `pricingCfg.affiliateRef` for percentage-based commissions, distinct from coupons.
12. **No SSO from Kajabi / Skool.** Kajabi supports SAML on the Pro tier. Skool doesn't. **Need at minimum: a "deep link with signed JWT" pattern** where Kajabi can mint a token, link to `acres-equity.acreos.io/sso/kajabi?token=...`, and AcreOS verifies + provisions + signs in. Without SSO every student has to set a second password on top of the one they already use for the course platform. Drop-off is brutal.
13. **No reseller-controlled feature flags** *per cohort*. The `features` JSON on `whiteLabelConfigs` is per-tenant (i.e., per *student* org). I want a parent-level template: "every student I provision gets `voiceAI: false, capitalMarkets: false, marketplace: true`." Today I'd have to PATCH each tenant individually. Add a `defaultTenantFeatures` JSON to a parent `resellerConfigs` table that doesn't exist yet.
14. **No graduation ceremony / certificate hook back to AcreOS.** When a student finishes my course and gets a PDF certificate, I'd love AcreOS to display a "Garrison Fox certified — Week 12 graduate" badge on their dashboard. Schema doesn't model this. Easy add: `users.certifications jsonb` or a `userCertifications` table. Status symbol → loyalty.
15. **No drop-off analytics per cohort.** I'd want, in the reseller dashboard, a funnel: "of 500 students provisioned in November cohort, 412 logged in, 287 imported a county, 198 sent first mailer, 73 made first offer, 24 closed first deal." The current dashboard shows aggregate `totalTenants / activeTenants / mrr` — no funnel visualization. This is the metric I'd send investors. Without it, my LP report is "trust me, students are using it."
16. **No way to embed AcreOS inside Kajabi.** Kajabi's "Custom Code" block accepts arbitrary HTML/JS. I want an `<iframe src="acreos.io/embed/{tenant}/today" data-jwt="...">` that lives inside lesson 4 so students never leave the course platform. Today the auth model assumes full-page browser context. Need a postMessage-based iframe SDK + Clerk session forwarding.
17. **No reseller-tier API limits.** The rate limits in `redisRateLimit.ts` are per-org. As a reseller fanning out 4,500 student orgs through one parent account, my admin API calls (bulk-provision, bulk-invite) need a separate, much higher limit. Cyrus flagged the same problem from the volume-operator angle; mine is the same shape from the channel-partner angle.
18. **No "demo mode" / sandbox tenant.** I want a perpetually-reset demo tenant for use in my course videos. Every record auto-deletes after 24h; logo and brand stay constant. So when I record lesson 4 saying "go to /leads, click Import," the screenshot doesn't show a previous demo's data. No surface for this today.
19. **No content-marketing pipeline.** I publish weekly to my email list. I'd love AcreOS to generate co-branded content I can republish: "How AcreOS users in your November cohort are doing — a pseudonymized weekly digest." This is a soft ask, but it's the difference between AcreOS being a tool I sell and AcreOS being a *platform I partner with*.
20. **No exit clause clarity.** What happens to my 4,500 student tenants if I terminate the white-label? Schema says `status: active | suspended | cancelled` (`schema.ts:281`). It does not say what happens to the *data*. Do students get a 30-day export window? Does AcreOS continue serving them direct at $199/mo? **This is the contract clause that makes or breaks the partnership.** I'm not signing a deal where my exit kills my students' businesses.

---

## 4. Pricing reaction

`Pricing.tsx:18-67`. Solo $199 / Operator $499 / Operation $1,290.

- **No student tier.** Solo at $199 is the floor. For a 4,500-student channel, I need a **Cohort SKU** at $79/seat/mo billed to me, with seat counts negotiable in 100-seat blocks. At $79 I can bundle into my $1,997 course as a "12-month included subscription, $79 × 12 = $948 of value at no extra cost" — even though my actual cost is $79 × 12 × 0.7 (after rev-share) = $663. This is the math that makes the bundle close.
- **No "education sponsor" tier.** This is what I'd call the reseller's own seat. Unlimited students under me. $499/mo to me. Includes the reseller dashboard, the bulk-provision tools, the rev-share rails, the funnel analytics, the support escalation. None of this exists as a SKU today.
- **The 70/30 split is upside-down for the *acquirer*.** I'm bringing 4,500 names. AcreOS is bringing the platform. At zero-CAC for AcreOS, even 50/50 leaves AcreOS with a much higher LTV than its self-serve students (whose CAC at $199 LTV is brutal). I'd pitch: 50/50 for first 500 students, 60/40 (AcreOS-favored) for 501–2,000, 70/30 for 2,001+. Tiered to reward the *ramp*, not penalize it.
- **No annual prepay discount for reseller.** I'd prepay 12 months at -25% to lock pricing and collect float. Schema's `plan` enum doesn't model billing cadence at the reseller level.
- **What I'd pay today, ungated:** $300K/yr if AcreOS ships #1 (course webhooks), #2 (bundled SKU), #4 (real revenue dashboard), #6 (CSV bulk invite), #10 (Clerk co-branded auth), and #20 (clean exit clause). Everything else is post-launch refinement.

---

## 5. The strategic question — Academy as competitor

I'll re-state #8 from the friction list because it determines the whole deal.

`client/src/pages/academy.tsx` ships in the AcreOS app today. 658 lines. It includes courses titled "Understanding MAO (Maximum Allowable Offer)", "Choosing Your First County", "Sending Your First Direct Mail Campaign", "Building Your First Buy-Box". **These are the names of my paid lessons.** The `routes-academy.ts:154-157` system prompt tells GPT-4: *"You are an expert real estate educator for AcreOS Academy. You help investors learn about land acquisition, seller financing, tax liens, due diligence, and land flipping strategies."* That's my job description.

If AcreOS sells Academy as a paid product, **I cannot resell AcreOS.** I'd be paying AcreOS to compete with me. If Academy is free, in-app, workflow-only — and AcreOS commits to never marketing it as "learn land investing here" — then we're aligned. **I need this commitment in writing before I sign.** The strongest version: AcreOS commits to *promoting reseller courses* inside Academy. Each course slot has a "Recommended educator" field; I pay for placement; my students see "Want to go deeper? Garrison Fox's 12-week cohort →" and click through to my Kajabi.

This is the highest-leverage product question in the entire reseller motion. It is not a feature; it is a posture. Without it, every other piece of work in this audit is wasted on me.

---

## 6. What's surprisingly good

1. **`whiteLabelConfigs` schema exists and is thorough.** Custom domain (UNIQUE), branding colors, support contact, feature flags, revenue share, plan tiering. The bones for a real reseller program are *there*. 80% of SaaS pretends multi-tenant is a v2 problem.
2. **`reseller-dashboard.tsx` is 807 lines of real UI** — tenant table, MRR chart, AI credit usage, status badges, action menus. This wasn't a stub. Whoever built it understood the channel-partner persona.
3. **Custom domain middleware exists.** `customDomainRouter.ts` looks up by domain on every request and injects tenant context. The hard part of multi-tenant routing is solved.
4. **Stripe Connect rails exist for *something*** (borrower payments), which means the company knows the API and has working code. Wiring it to white-label payouts is a port, not a greenfield.
5. **Promo code support is real.** `stripeService.ts:50-54` and `routes-billing.ts:306-321` show real coupon plumbing. The path to affiliate-percentage extension is short.
6. **AI tutor architecture is right.** Credit-deducted, system-prompt-aware, history-windowed (last 6 messages, `routes-academy.ts:161`). If repurposed as workflow education only, this becomes my best onboarding tool, not my competitor.
7. **The persona architecture rule from project memory ("Customers see Pax only; founder sees Sophie/Forge/Atlas").** This is exactly the discipline I need: my students see *my* brand and Pax. They don't see Garrison Fox the platform-vendor. Branding hygiene is already a codified principle.

---

## 7. The bugs I found while reading the code

I read the implementation, not just the surfaces. Three things to flag:

1. **`courses` table has no `organizationId` column.** `shared/schema.ts:9826-9865` defines twelve columns on `courses` — title, description, category, pricing, instructor, status, analytics — but no FK to `organizations`. Yet `server/services/education.ts:36` does this:

   ```ts
   const [course] = await db.insert(courses).values({
     organizationId,
     title: courseData.title,
     ...
   ```

   `organizationId` is a phantom column. Either Drizzle silently strips it on insert or the runtime error has been masked because no one has actually called `createCourse` from a non-founder context. **This means there is no way today to scope a course to a tenant.** All courses are global. If I publish my 12-module curriculum into AcreOS Academy, every other tenant on the platform sees it. Every other reseller sees my IP. This is the single most important fix before any reseller can put curriculum into Academy. Two-engineering-week fix: add the column, add a `visibility` enum (`tenant_only | network | public`), backfill the parent-tenant chain into every list/get/recommend query in `education.ts`.

2. **The Academy is two systems pretending to be one.** `client/src/pages/academy.tsx` carries a hardcoded TSX catalog (MAO, Mail Campaigns, Due Diligence — exactly my topics). `server/routes-academy.ts` exposes a database catalog that no one populates. They don't talk. So the user-visible Academy is a static array shipped in JS, while the API surface assumes a populated DB. Reconcile to one source of truth before reseller curriculum injection makes any sense.

3. **`getResellerReport` returns hardcoded zero revenue and the analytics endpoint silently swallows it.** `whiteLabelService.ts:246` returns `totalRevenue: 0` with the comment "Would be calculated from Stripe in production." Then `routes-white-label.ts:117` does `.catch(() => null)` and falls back to zeros for every KPI — `totalUsers`, `totalRevenue`, `mrr`, `totalAiCreditsUsed`. So the reseller dashboard at `client/src/pages/reseller-dashboard.tsx` doesn't show "data unavailable" — it shows convincing-looking zeros. I'd brief my LP on those zeros and feel like a fool. Either render an explicit "Stripe Connect not configured" empty state, or wire the rollups before showing the surface.

---

## 8. What's missing for cohort retention — the dashboard I'd live in

The metric I'd open every morning isn't MRR. It's per-cohort retention.

When I run a November cohort of 500 students, I need a single page in the reseller dashboard that shows: of those 500, how many logged in this week, how many have hit each onboarding milestone, who's gone dark for 14+ days, and who's likely to refund. Today I can see *none* of this from outside AcreOS.

- `routes-academy.ts:74` (`GET /enrollments`) returns *only the current user's* enrollments. There is no tenant-admin endpoint that returns "all enrollments for users in tenant X."
- `routes-cohort-analysis.ts` builds segment reports, but the cohort segments are AcreOS-internal (signup-month, plan-tier). I can't say "everyone who bought my November cohort = cohort 47" and pull a report — there's no `cohortId` column on `courseEnrollments` or `users` that a tenant admin controls.
- There's no CSV export endpoint scoped to a tenant. I'd build the dashboard surface myself but I need the data API to power it.

What I'd build, if I were AcreOS engineering, in priority order:

- `GET /api/white-label/tenants/:id/students` — paginated student roster with last-login, current cohort, course-progress percentage, AcreOS-feature-activation flags (imported a list yes/no, sent a mailer yes/no, logged a deal yes/no). This is the table view I need.
- `GET /api/white-label/tenants/:id/cohorts/:cohortId/report` — cohort-level rollup: completion rate, median time-to-first-deal, drop-off module, NPS by week.
- A `cohort_id` column on `courseEnrollments` or a `tenant_cohorts` table with a many-to-many. Today there's no concept of a tenant-defined cohort.
- Outbound webhooks (`enrollment.progressed`, `enrollment.completed`, `student.activated`, `student.dormant_14d`) so I can fire my email automations off AcreOS events without polling. The `webhookDispatcher.ts` file exists but isn't wired to a generic event bus, isn't HMAC-signed for outbound delivery, and has no operational surface (delivery log, retry queue, dead-letter visibility) in the reseller dashboard.

Without these, the bundle doesn't work — I'd be flying blind on retention, which is the only number that matters when you're shipping cohorts.

---

## 9. The deal-breaker

For Wendell it's the note ledger. For Cyrus it's bulk-action chunking. For Penelope it's RBAC. **For me it's whether AcreOS Academy is a product or a feature.**

If Academy is a product — i.e., AcreOS plans to sell courses, run cohorts, charge for "learn land investing here" — I will not resell AcreOS. I will evaluate the next platform in Q3.

If Academy is a feature — workflow education only, never sold separately, with explicit slots for reseller course promotion — and AcreOS ships items #1, #2, #4, #6, #10, #20 from the friction list within 90 days, **I sign a 3-year exclusive reseller agreement, deliver 4,500 names by end of 2026, and become the reference customer for every other course-business reseller you'll ever sign.** Six other land-investing educators in my mastermind would follow within a year. That's 18,000+ student names through this channel by 2027.

The smaller version of the bet: **founder picks up the phone, gives me a 60-minute strategic call by mid-May, and we walk through items 1, 2, 4, 6 above.** If we agree on 50/50 for the first 500 students and a Q3 launch for course-platform webhooks, I'll move my November cohort onto AcreOS as the pilot.

Until then I keep sending students to the Sheets template. The Sheets template doesn't compete with my course.

— Garrison
