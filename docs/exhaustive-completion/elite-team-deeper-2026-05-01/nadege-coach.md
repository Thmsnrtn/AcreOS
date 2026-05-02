# Nadege Bishop — AcreOS user review (coach + course creator)

I'm 47. Chicago. Ten years ago I was wholesaling infill lots out of a corner office in the Loop and grinding cold-call lists at 6am. Today I run a coaching business: two cohorts a year through "Land Cohort" ($2K, 8-week course, ~120 students per cohort), 1:1 strategy calls at $500/hour, and a small affiliate program where graduates who refer the next cohort get a kickback. My students need a CRM to actually run deals on. I've spent the last four years on Trello-and-Airtable Frankensteins, then a Land Geek-flavored stack everyone hates, and now I'm evaluating AcreOS as the tool I'd standardize on, screenshare with on coaching calls, and — if it's good enough — make a piece of the curriculum.

So I'm not auditing AcreOS as a single operator. I'm auditing it through three lenses simultaneously: **(a)** is it good enough that I'd build a course module around it; **(b)** can I demo it on Zoom without 90 students seeing my real client data; **(c)** can the platform itself become a revenue line for me through affiliates, white-label cohorts, or a bundled discount.

I spent a full day inside it. Here is what I found.

---

## 1. Thirty-second verdict

Would I adopt it for my cohort? **Conditional yes — but not as currently shipped.** The product is closer to where I need it than anything else on the market. The CRM bones are solid, the deal pipeline is recognizable, the founder Sophie/Forge surfaces are not in my way. **What's missing is everything that turns a CRM into a teaching surface**: a sandbox mode that doesn't pollute real orgs, a clean instructor view, a way to provision 120 student accounts in one shot without me writing scripts, and any kind of affiliate plumbing that actually tracks attribution past signup.

If I had to grade it: the operator product is a B+. The "platform that supports an instructor ecosystem" product is a D, because nobody has built it. **And that ecosystem is, structurally, the cheapest possible distribution channel AcreOS has** — every coach in this space brings 50 to 500 paying students who need a tool. Not having instructor-mode is leaving the channel on the table.

---

## 2. The seven things I need — and what AcreOS actually has

### **(1) Sandbox / demo mode I can screen-share without leaking real data.**

When I'm on a Zoom with 90 students walking through "here's how you triage a county list," I cannot have my actual client data on screen. Today, my workaround on every other tool is: a separate "demo" account I maintain by hand, with fake leads I made up, that I have to keep refreshing because the data goes stale. It's hours of upkeep per cohort.

What AcreOS has: nothing. There's no demo-mode toggle. There's no fake-data overlay. There's no per-org "redact PII for screenshot" button. If I share my screen with my own org, my students see real seller names, real phone numbers, real numbers in the deal pipeline. That's a HIPAA-flavored problem even when the data isn't health data — my buyers and sellers didn't consent to be a teaching example.

What I'd build:
1. A **"Sandbox" org type** alongside the existing org. Created on demand from a "spin up demo" button. Pre-seeded with 50–200 fake leads, 10–20 properties at varied stages of the pipeline, three deals in flight, a populated calendar. The fake data should look real (real-shape APNs, real-shape addresses in three states) but be obviously not-real (names like "Demo Smith" or pulled from a public fake-name corpus). Sandboxes auto-expire after 30 days unless renewed.
2. **A sandbox toggle on the existing org** — a single switch in the topbar that swaps in a redacted overlay: names → "Lead 1, Lead 2", phones → "(555) 555-XXXX", dollar amounts rounded to nearest $1k, addresses replaced with city-only. Real behavior, real workflow, but presentation-safe. Toggle off when I'm done teaching.
3. **A "demo session" link** I can send to a prospective student that drops them into a read-only sandboxed walkthrough of a sample deal, with no signup required. Three minutes of clicking, no commitment. That's the lead magnet.

The shape exists in the codebase already — `getOrCreateOrg`, the org-scoped data model, the `organizations.onboarding*` columns. A sandbox is just an org with a flag. The redaction overlay is a client-side rendering decision. **Two weeks of work for something that opens the entire coach-channel market.**

### **(2) Bulk student provisioning — 120 accounts in one shot.**

When my cohort starts, I have 120 paid students. Today, on every other CRM, I either pay per seat from my own pocket and grant them limited logins (margin-killing), or I ask them to sign up individually with my coupon code (40% never finish signup). Neither is good. What I need is: paste in 120 emails, they get an invite, they show up in my "cohort dashboard," I can see who's logged in, who's done module 3, who's stuck.

What AcreOS has: org-level multi-user already — a founder can invite team members under one org. That's the wrong shape for a cohort. A cohort isn't 120 employees; it's 120 *separate* organizations that I have a teaching relationship to. Each student needs their own org because each student is running their own deals. I need to be a federation layer above all 120.

What I'd build:
1. A new entity: **`cohorts`** — a coach-owned grouping of student orgs, with a name ("Cohort 11 — Spring 2026"), a date range, and an invite link template.
2. **Bulk invite** — paste a CSV of emails, the system sends each a Clerk-mediated signup link tagged with the cohort. On signup, a fresh empty org is provisioned for each student with the cohort flag set.
3. **Coach dashboard view** — list of all student orgs in a cohort, with anonymized rollup metrics (logins this week, leads added, deals in pipeline, days since last activity). I'm not snooping on their data, I'm seeing engagement signals. The student opts in to share these by joining the cohort.
4. **A "request screenshare access" flow** — when I'm on a 1:1 coaching call, I send a link, the student approves, and I get a 60-minute read-only window into their org with a banner on their side showing "your coach is viewing." Logs every view in the audit log.
5. **A cohort-only Slack/Discord-style channel** — out of scope for v1; punt to existing tools.

The auth and org plumbing already exists. The cohort layer sits on top. **Three to four weeks of work** if the team is disciplined about not scope-creeping it into a full LMS.

### **(3) Affiliate tracking that actually attributes.**

There's a `routes-referral.ts` file. I read it. **It tracks referral codes at signup time.** That's the easy 10%. The hard 90% is: was the referral the *cause* of the conversion, did the converted user upgrade to paid, did they retain past month 3, did they generate enough revenue to justify the kickback. The current shape of the referrals table — `referrerId, code, status: pending|signed_up|converted, creditAmount` — is roughly the shape of a 2014 affiliate program. It will not survive me bringing 120 students per cohort, two cohorts per year, with overlapping codes from graduates who run their own micro-affiliate programs downstream of mine.

What AcreOS has: a code generator, a stats endpoint, credit accumulation. No multi-tier attribution. No payout pipeline. No 1099 generation. No fraud detection (I send a code to my own burner account and farm credits — there's no signal that catches it). No first-touch-vs-last-touch logic when a user clicked three different referral links before signing up.

What I need:
1. **A first-touch attribution cookie**, set on the marketing site, persisted for 90 days, that survives the user clicking other links in between. Stored server-side keyed to a session cookie so it's not just localStorage that they clear.
2. **A `referral_attribution` table** on every conversion event — not just signup but each upgrade, each renewal — with `attributed_referrer_id`, `attribution_model` (first-touch / last-touch / linear), `dollar_amount`, `commission_pct`, `commission_dollar_amount`, `paid_out_date`, `claw_back_window_ends`. Commissions are not paid out the day of signup; they're paid out after a refund window closes (typically 30–60 days).
3. **A coach-facing affiliate dashboard** showing pending commissions, paid commissions, clawed-back commissions with reason, and a clear monthly ledger. With 1099-NEC export at year end.
4. **Multi-tier support** so that if my graduate Tina refers Bob and Bob signs up, Tina gets her commission but I — as Tina's coach who originally referred her — get a smaller override commission. Two levels deep is plenty; deeper than that and it's an MLM and I won't touch it.
5. **Fraud rails**: same-IP signups within 24 hours of a referral click flagged for manual review. Same payment method across multiple referred accounts auto-rejects. A maximum payout per referrer per month until they hit a manual approval threshold.

The current implementation is fine as a v0 to validate that affiliates work at all. **It is not the system I would let process even $50K of annual commission payouts without rebuilding.**

### **(4) Course-platform integration — Stripe + Kajabi/Skool/Thinkific.**

I sell my course on Kajabi. Students pay $2,000 in Kajabi, get into the course there, and *then* I need them in AcreOS. Today on every other tool, I manually copy the email list from Kajabi into the CRM's invite flow. It's a Tuesday-night chore.

What AcreOS has: Stripe billing for subscriptions. No webhook from external course platforms. No way to say "when my Kajabi sends a `purchase.completed` event, auto-provision an AcreOS sandbox account at the cohort tier and send the welcome email."

What I'd build:
1. A **generic `course_platform_webhook` endpoint** that accepts Kajabi, Teachable, Thinkific, and Skool webhook signatures. On `purchase.completed`, looks up the SKU in a coach-configured mapping (`SKU_LAND_COHORT_2026 → cohort_id 11, plan_tier "student"`) and provisions a student org in that cohort with the right tier and entitlements.
2. A **reverse webhook** — when a student org gets created or completes its onboarding, fire an event back to the course platform so the course can mark a milestone complete. ("AcreOS account provisioned — go to module 2.")
3. **A coupon/discount layer** so I can sell the course bundled with AcreOS: my $2K cohort fee includes 6 months of AcreOS at a discounted SKU, billed through me, with the difference going to AcreOS as a wholesale rate. White-label-ish, without going full white-label.

The Stripe and webhook infrastructure is in the codebase. The course-platform side is purely missing. **Two weeks for one platform; another week per additional platform supported.**

### **(5) Instructor / "view as student" mode.**

When a student is stuck on a coaching call — "my CMA isn't pulling comps, I don't know why" — I need to see what they're seeing. Not a screenshare; an actual session inside their org from their permission level. The founder/Sophie persona surfaces are in my way here. I'd want a "view as this student" toggle that strips the founder UI down to the student-tier UI, so I can reproduce their bug or walk them through a workflow at exactly their permission level.

What AcreOS has: a persona architecture (Pax for customers, Sophie/Forge/Atlas for founder). No "view-as-student" mode. The closest analog is the founder's ability to see everything, which is the opposite of what I want — I want to see *less*, exactly what they see.

What I'd build:
1. A **`view_as` session header** that downgrades the current user's effective tier to a target tier for the duration of the session. Banner shown at all times: "Viewing as: Student tier — exit view." Logs every action taken in this mode to the org's audit log so the student can see what I did.
2. A **side-by-side mode** for coaching calls — left pane is my view, right pane is the student's literal screen mirror. Punt to existing screenshare tools if this is too heavy.
3. **Tier-accurate empty states** — when I'm in view-as-student mode and the student hasn't run a CMA yet, I see the same empty-state CTA they see, not an "import data" button that only the founder tier has.

The permission system is granular enough to support this — there's a `permissionContext` on the request already. **One week of work** if scoped tightly.

### **(6) Screen-share-friendly UI.**

This is small things that compound. When I'm on a Zoom at 1080p with a small video tile of my face overlaid on the AcreOS UI, I need:
- **High-contrast presentation mode** — fonts bumped up by 25%, sidebar collapsed, tooltips disabled (they're noise on a screenshare), modals get a dim-the-background treatment so the student's eye doesn't wander.
- **Cursor highlighting** — a soft yellow halo around my mouse pointer so 90 students can see what I'm pointing at. Native OS-level cursor highlighters exist; the platform should optionally add one.
- **A keyboard shortcut overlay** — when I press a hotkey, a brief tooltip animates over the just-pressed shortcut, so students can see "oh, ⌘K opens search." Useful as a teaching aid.
- **Redaction-on-screenshot** — when I take a screenshot of AcreOS for course material, I want a single keystroke that exports the current view with all PII redacted. Today I do this in Photoshop; that's friction that means I screenshot less, which means my course is worse.
- **A "presentation theme"** — neutral colors, high contrast, no blinking notifications, no toast popups with random "credit deducted" messages over the top of my demo.

The existing chrome shell (`PageTopbar`) is the place to hang a "presentation mode" toggle. **One to two weeks of polish work** that pays back every time any coach in the ecosystem demos the product to a room.

### **(7) Curriculum hooks — let me tie my course to the product.**

This is the ambitious one. I have an 8-module course. Each module ends with a practical exercise: "use the product to triage a sample county list." Today, that exercise lives in a PDF I email out, students do it on whatever tool they have, and I have no idea who actually completed it. I can't grade it. I can't celebrate it. I can't see who's stuck.

What I'd build (call it a v2; not for first release):
1. A **`curriculum_milestone`** entity — a coach-defined task that expects to see a particular state in the student's org. Examples: "import your first 100-record county list" (checked when `leads.count >= 100`), "send your first letter campaign" (checked when at least one campaign exists with `status = sent`), "log your first responded lead" (checked when at least one lead is in `responded` status).
2. **Webhook out** to the course platform when a milestone is completed, so the next module unlocks automatically.
3. **Coach dashboard view** — heatmap of cohort completion across milestones. Module 3 has 12 students stuck — I should run an extra Q&A on it.
4. **Optional gamification** — student-facing badges for milestone completion, opt-in. Some students love this, some find it patronizing; let them turn it off.

This is a real product surface, three to six weeks of work. **It is also the thing that makes AcreOS irreplaceable in my course** — because once my curriculum is wired to the milestones, students can't switch tools mid-course without losing their progress tracking. That's stickiness I'd happily pay for as a coach because it lowers my support load and lifts completion rates, and it's stickiness AcreOS gets for free as the substrate.

---

## 3. The data shape that's wrong

Beyond features: the org model assumes one org = one business. For coaches, one org = one student of one cohort of one coach, and the relationships matter. The schema needs:

- A `cohorts` table — `id, coach_user_id, name, date_range, invite_link, default_tier`.
- A `cohort_memberships` table — `cohort_id, student_org_id, joined_at, completion_status`.
- A `coaching_relationships` table — `coach_user_id, student_org_id, relationship_type` (cohort / 1:1 / sponsored), `permission_grant` (read-only / view-as / full).
- A `referral_attribution` table — replacing the thin `referrals` table — with proper conversion-event tracking, attribution model, and clawback support.
- A `course_platform_link` table — `coach_user_id, platform` (kajabi/teachable/etc), `external_account_id, webhook_secret, sku_mapping_json`.

None of this is exotic. **It's the shape of every B2B2C platform that supports a creator economy on top of itself.** AcreOS has the bones; the coach layer is unbuilt.

---

## 4. The smaller stuff that adds up

A handful of papercuts I noticed during the day inside the product, all of which are independently small but which compound when I'm trying to teach with this thing:

- **Toast notifications during a demo.** I was walking through the lead detail view and a toast popped up telling me a credit had been deducted for an enrichment lookup. The number was real. My students would have seen it. There is no "quiet mode" for toasts, and the credit number is something I'd very much rather not show 90 strangers on a Tuesday night.
- **The founder-only Sophie/Forge/Atlas surfaces** are bleeding into routes I'd otherwise want to teach on — at least one of the deal-room views had a "Forge says" sidebar I couldn't dismiss, and the persona architecture rule (per the project memory) is that customers see Pax only. The student tier should never see Sophie. I saw Sophie. Either my account is mis-tiered or the gating is leaky.
- **The onboarding wizard asks for things a brand-new student doesn't have** — the org's existing onboarding flow assumes the user already has a business name, an LLC, comp data, target counties. A student in week one of my course has none of those. The wizard should detect "this org was provisioned via a cohort flow" and run a stripped-down version that gets them to a usable empty state in 30 seconds, not 15 minutes.
- **No way to clone a sample deal into a student's org** so they have something to poke at on day one. Empty states are intimidating in a teaching context. The first session of my course should end with the student seeing a populated pipeline, not a "you have no leads yet" page.
- **The keyboard shortcut layer is undiscoverable.** ⌘K opens command search — great. There is no on-product `?` overlay listing every shortcut, the way Linear and Notion ship one. For a teaching surface, shortcut discoverability is force-multiplied — I teach the shortcut once, 120 students adopt it.
- **Search results during a demo include real lead names from autocomplete history.** Even if I'm careful about what's on screen, the autocomplete betrays me. There needs to be a "clear search history for this session" or, better, a session-scoped autocomplete that doesn't persist to the demo-mode org.

None of these are individually fatal. Together they describe a product that has not yet been used in a teaching context by anyone serious.

---

## 5. What I'd actually pay for

If this existed, I'd pay $5K/year for the coach tier (sandbox + cohorts + view-as + affiliate dashboard). **And I'd put 120 students per cohort, two cohorts a year, into AcreOS at the student tier — call it $30/month per student for 6 months — that's $43K of student LTV per year I'm sending to AcreOS.** Per coach. There are dozens of coaches like me in this niche. The arithmetic is obvious; the surface to capture it is missing.

The current product is good enough that I'd still consider it for my own deals. **It is not yet good enough that I'd build my course on top of it.** That gap is the work above.

---

## 6. The single thing I'd build first

If the team can only do one thing in the next quarter to capture the coach channel, it is **sandbox mode with a one-click reset**. Not cohorts, not affiliates, not curriculum hooks — those all matter, but they all require a coach who has already adopted the product. **A sandbox is what gets the adoption in the first place**, because it's what lets me spend a 90-minute teaching session inside AcreOS without exposing my real book of business to 90 students. Build the sandbox, and every coach in this niche becomes a possible distribution partner. Don't build it, and the channel stays closed regardless of how good the rest of the product gets.

That's the single highest-leverage week of engineering work in the entire roadmap from where I sit.
