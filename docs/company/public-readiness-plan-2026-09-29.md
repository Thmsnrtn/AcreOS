# From zero customers to general availability — the readiness plan

*2026-09-29. Written from a verification pass over the repository at the
head of `claude/acreos-maturity-research-findings-nhj3a1`: the defect
registry, `docs/company/mature-machine.md`, the go/no-go and launch
checklists, the platform config, three read-only surveys, and a
defect-repair cycle (DEFECT-0160 to 0184) in which every batch went through
an independent audit. It is read
through six lenses: CEO, CFO, CTO, SRE/SaaS operations, a practising land
investor, and general counsel.*

*Layering: this is a horizon plan under `docs/company/mature-machine.md`.
It fills in how to cross G0 and G1 and does not replace them. It
relitigates none of the standing decisions in CLAUDE.md's DO-NOT-DO list,
and every item that needs a founder call is marked 🔑.*

---

## 1. The verdict

AcreOS has broad scope and little proof.

- **The product is deep.** It has five doors, owner-finance servicing that
  is more rigorous than most dedicated servicers, an approval kernel on
  every AI-written send, and about 1,140 test files behind a gate suite of
  roughly 35 lint and ratchet scripts.
- **It has never carried a paying customer.** The root `customers.md` reads Active 0
  / Trial 0, and the go/no-go (`docs/company/go-no-go-2026-07.md`) is
  AMBER-GO.
- **The ambers are not features.** They are:
  - credentials the founder has not yet provisioned;
  - external proof that has not been produced: deliverability, a restore
    drill, and a DNC vendor;
  - one broken promise: a sourced parcel list, fast.

Two numbers define "ready for the general public", and neither is a
feature count:

1. A stranger can go from signup to a mailed, compliant offer on a real,
   sourced parcel list in their county inside one session, with no founder
   help. Time-to-first-mail is the product metric (H1).
2. The operation survives that stranger. Backups restore, the deploy gate
   blocks bad code, cold outreach can't reach a DNC number, their money
   never touches AcreOS's balance, and the founder's weekly hours stay
   inside the scoreboard.

So the plan is: **prove before build, narrow before wide, and delete while
proving.** More code is a named trap (mature-machine §7.6). Most of what
follows is switching things on, drilling them and measuring them.

## 2. Where it actually stands

| Area | State | Evidence |
|---|---|---|
| Core land loop: lead → mail → reply → offer | **Real.** BYO send rails; the approval kernel witnesses every send | `server/services/approvalKernel.ts`, `shared/pax-controls.ts` |
| Sourcing a parcel list | **The break.** Only the org's own properties are shown; there is no county-universe builder. The landing page promises "your first county list inside 10 minutes" | `client/src/pages/landing/copy.ts`; the Market Launchpad exists only as a proposal |
| Offers and pricing | **Honest.** The blind-offer wizard refuses to price with no comps; batch offers price only from evidence | DEFECT-0107, 0172 |
| Closing | **Real, with an evidence-gated wire interlock.** Documents are lost from `/tmp` (0143); no file storage exists (0046) | DEFECT-0176, 0180 |
| Listing and buyers | **Real and now honest.** Withdrawal is verified, only held land is offered, sold land comes off the market on every status path, and buyer audiences are tenant-safe | DEFECT-0173/0174/0177/0179/0181/0182 |
| Note servicing | **The deepest area.** Cents-exact posting, the payoff engine, the borrower portal. Late fees assessed vs collected is open (0099); debits after an org cancels need a policy (0106) | DEFECT-0096–0100 |
| Tax (1099-INT) | **Refused, deliberately.** It waits for a qualified tax review | DEFECT-0101 |
| Backups | **Dormant** until the S3 bucket and keys exist | `server/jobs/jobRegistry.ts` (🔑) |
| DNC scrub | **Allows everything** while `DNC_SCRUB_PROVIDER` is unset | `server/services/compliance/dncScrub.ts` (🔑) |
| Deploy gate | Prod deploy waits on its own test job but **not** on `ci.yml` (lint, ratchets, coverage) or `security.yml` | `.github/workflows/deploy.yml` |
| Tenancy | App-level only, with no Postgres RLS. Independent audits in this cycle found two live cross-tenant paths: the buyer blast emailing another tenant's leads (0179), and bulk delete HARD-deleting another tenant's deals and listings by request id (0183, P0). The tenancy lint had never read an UPDATE or DELETE at all (0184). A write-scope ratchet now freezes the debt: 250 unscoped writes across 144 file×table keys, down only | `scripts/check-org-scoped-fetch.mjs`, `tests/unit/orgScopedWritesRatchet.test.ts` |
| Scale ceiling | About 48 reads are capped at 5,000 rows; exports refuse rather than truncate | DEFECT-0171 |
| Legal | A sole proprietorship. The LLC, EIN, registered agent and counsel review of the Terms/Privacy are all open | `docs/legal/launch-readiness-checklist.md` |
| Public claims | 13 of 15 verticals are publicly demoted to beta. The "10 minutes" county-list claim is unsupported | `shared/business-types/publicClaims.ts` |

## 3. What each seat would insist on

**CEO: one persona, one loop, one county, then repeat.**
- The land flipper doing mail-first outreach is the wedge (H1). Serve that
  journey end to end before anything else.
- Every other vertical stays behind its honesty bar (ruling #11) and gets
  no new investment until G1.
- The landing claim must match the product on the day an ad points at it.

**CFO: margin and money truth before growth.**
- Measure CAC on the $5/day witnessed campaign before any real budget
  (the §6.8 H0 criterion).
- Hold gross margin at 70% or more with per-tier COGS ceilings. Credits
  and BYO rails already make most variable cost the customer's.
- Founding-member pricing is decided (`docs/company/decision-memos/2026-07-08-founding-member-pricing.md`).
  Do not reprice before G1 (trap #9). 🔑 Pricing is founder-only.

**CTO: stop adding surface; make the existing surface unbreakable.**
- Gate prod deploy on `ci.yml` and `security.yml`, not only on its own
  tests.
- Run the credentialed wedge E2E (signup → lead → mail → reply → offer) in
  CI. This is H0 §6.4, and it is blocked only on Clerk test credentials 🔑.
- Close the one deferred data-loss defect: document storage (0143/0046).
  🔑 The storage choice is the founder's.
- Keep the registry and ratchet discipline this branch uses: red-first,
  gates to a file, an independent audit before every push. All 25 fixes
  this cycle (0160 to 0184) went through it. Every audit round found real
  residue, and four found blocking gaps in the fix itself. That is the
  single best argument for keeping the audits: a green report is a
  hypothesis.

**SRE: nothing about the operation is proven until it has been drilled.**
- Turn backups on and run the restore drill (X-8). An unrestored backup is
  a hope.
- Pin background jobs to the `worker` process and verify `DB_POOL_MAX`
  under load (DEFECT-0049).
- Arm uptime probes, Sentry and the log drain (🔑 secrets), and publish a
  real `/status`.
- Run the k6 scripts in `tests/load/` once against staging at 10× the
  25-customer load before the first ad.

**Land investor: the product has to answer "where do my parcels come from?"**
- Today it can't, and the free data plane doesn't close that alone. A
  practitioner judges a land tool in its first five minutes on three
  things: can I pull a list in my county, can I mail it cheaply and
  compliantly, and can I price an offer I'd defend? AcreOS does the second
  and third well and fails the first.
- The fix is the sales/parcel-data licence decision (founder-decisions
  2026-07-28 #14 and H0 §6.2) plus a list builder behind the Map door.
  That door is the "Market Launchpad" the research proposed. It is not a
  new top-level entry.
- Pace campaigns to response capacity, and treat the buyer side as
  relationship and permission, not "blast everyone" (the practitioner
  supplement).

**General counsel: form the company before taking the first dollar, and
keep refusing what the law hasn't been asked about.**
- 🔑 Form the MA LLC, get an EIN and a registered agent, and have counsel
  review the Terms, Privacy Policy, DPA and disclosure pages (X-7).
- 🔑 The DNC vendor goes live before any cold SMS (H0 §6.1).
  Servicing-text DNC scope needs a legal read.
- Keep 1099-INT refused until a qualified tax reviewer signs off
  (DEFECT-0101).
- 🔑 Seller-side "divorce", "health" and "retirement" motivation signals
  are recorded for legal review (DEFECT-0178). Decide them before
  prospecting at scale.
- Keep the e-sign ceremony external (ruling 2026-08-20). No money custody,
  ever.

## 4. The plan in four phases, each ending at a measurable gate

### Phase 0: The operational floor (2 weeks) → exit when every item is green

Almost all of this is switching things on and drilling them. Engineering is
the smaller half.

| # | Item | Owner |
|---|---|---|
| 0.1 | Provision the 🔑 secrets that arm what is already built: backup bucket and keys, `SENTRY_DSN`, `LOG_DRAIN_URL`, `UPTIME_PROBE_URL`/`TOKEN`, `REDIS_URL`, paging, `FLY_STAGING_APP`, live `STRIPE_PRICE_*`, `AWS_SES_FROM_EMAIL`, `DNC_SCRUB_PROVIDER` + Searchbug | Founder |
| 0.2 | Restore drill: `backupRestoreVerify` passes once for real, and the result is recorded | Founder + agent |
| 0.3 | `deploy.yml` needs `ci.yml` and `security.yml` to pass on the SHA; add a `migrate.mjs --dry-run` step | Engineering |
| 0.4 | Background jobs run only in `worker` (`DISABLE_BACKGROUND_JOBS=1` on `app`), verified by the deadman | Engineering + founder |
| 0.5 | Credentialed wedge E2E in CI (Clerk test ticket 🔑) | Engineering |
| 0.6 | Document storage: pick S3 or R2 🔑, then fix 0143 so imports persist | Founder decides, engineering builds |
| 0.7 | Rewrite the landing claim to what the product does today, and keep the "10 minutes" promise out until 1.2 ships | Engineering (copy) |
| 0.8 | Legal formation and counsel review (X-7) | Founder |
| 0.9 | SPF/DKIM/DMARC plus a deliverability proof on the org-owned send path (X-6) | Founder |

**Gate G0** (from mature-machine §2): wedge E2E green in CI, 30 days of
clean uptime probes, DNC scrub live, and all acting switches off.

### Phase 1: Design partners (weeks 3–8) → 3–5 real operators, witnessed

The aim is observation. Five land investors run their real business on
AcreOS, free or at founding price, and every session teaches us something.

1. **Close the sourcing gap** (the investor's #1 ask).
   - 🔑 Make the parcel/sales-data licence decision for the launch
     counties.
   - Then ship a **list builder under the Map door**: pick a county, filter
     acreage, owner type and years owned, save it as a lead list, and see
     the count and cost before committing.
   - This reuses the provider registry and the existing lead-list model.
     It is not a new platform.
2. **Instrument the funnel.** Time-to-first-mail, time-to-first-response,
   response-to-offer and offer-to-contract per cohort. These activation
   events already exist in `shared/schema.ts`; they need a single founder
   view in The Letter, not a new door.
3. **Fix what partners hit, in registry order.**
   - DEFECT-0171/0169: capped reads, which will bite a partner with a big
     book.
   - 0099: late fees assessed vs collected.
   - 🔑 0106: the cancellation policy for borrower debits.
4. **Support is real.**
   - Publish one SLA. The code assumes 15 minutes and the playbook says 4
     business hours; pick the playbook's.
   - Every `escalate_to_human` reaches the founder's phone.
5. **Delete as you learn** (H2's deletion campaign, started early). Any
   surface no partner touches in six weeks goes on the deletion ledger.

**Gate:** three partners each complete a full loop (list → mail → reply →
offer). Median time-to-first-mail is 30 minutes or less, with no founder
intervention inside the session.

### Phase 2: Paid founding cohort (weeks 9–20) → G1 (25 paying, ~$2K MRR)

1. Run the witnessed $5/day Meta campaign from the founder ad account
   (founder-only, ruling 2026-08-13). Ramp +50% only on proven CAC.
2. Onboarding: "<90 s to value" is sacred. Cut the measured
   7:30 time-to-aha to 4:00 or less (`docs/launch/`). Clear sample data
   the moment real data arrives.
3. Flip autonomy switches only per mature-machine §4, after clean
   witnessed cycles on real tickets: support auto-resolve, then dunning
   recovery.
4. Security posture for strangers:
   - add Postgres RLS on the ten highest-value tables as defence in depth,
     on top of the lint (not instead of it);
   - run a third-party penetration test before G1;
   - publish `/security`, which already exists, with the results summary.
5. Accessibility: fix the contrast failures across the 12 themes, and the
   sliders that can't be named, flagged in the 2026-09-04 elite-bar review.

**Gate G1:** 25 paying customers, fewer than 2 founder pages a week, dunning
recovery measured working, gross margin ≥70%, and CAC measured (not
null).

### Phase 3: General availability (after G1) → open signup, self-serve

- Remove "founding" from the pricing page. 🔑 Adopt list pricing per the
  memo (Pro $79 / Scale $149).
- Earn public-maturity claims vertical by vertical: a vertical claims
  "core" only when decision snapshots exist (`publicClaims.ts`). Leave the
  rest honest-beta.
- The marketplace unlocks at ~25 customers and the public API at ~50, per
  the expansion ladder. Each needs an explicit founder unlock, because
  today `expansionLadder.test.ts` fails if either is switched on.
- Error-budget policy and 99.9% quarterly probe uptime (the G2 criteria)
  become the operating standard.

## 5. The engineering programme under the phases

Ordered by the consequence of getting it wrong. Each item is one bounded
change with red-first proof, the way this branch has worked.

1. **Money and communication obligations.**
   - The remaining registry OPEN items: 0099, 0106, 0171, 0169.
   - The DEFECT-0178 legal-review items.
2. **Tenancy as a property, not a habit.**
   - RLS on the top tables. This is the highest-leverage engineering item
     in the plan: 0183 was a cross-tenant hard delete in a population the
     lint never read (0184: rule 3 sees SELECT chains only). RLS makes the
     whole class fail in the database, whatever the statement looks like.
   - Burn down the 250 frozen unscoped writes: route handlers first, then
     storage repos, then agents. Each fix lowers the ratchet in the same
     commit.
   - Keep the lint, and widen its population as each audit finds blind
     spots, as it did three times this month.
3. **Data durability.**
   - 0143/0046 file storage.
   - The restore drill as a weekly CI-visible signal.
4. **The wedge E2E and load tests, in CI.**
5. **The deletion campaign** (H2, started now).
   - The 477 KB schema chunk in the client bundle (0027).
   - The 3,089 deferred TypeScript errors (0067): retire them by deleting
     the modules that hold them where possible.
   - `runScheduledJobs.ts` at 5,706 lines.
   - LOC ≤650K and tables ≤500 are the G2 targets.
6. **The ratchets keep going down.** `as-any` is 1,096, `colon-any` 2,669,
   `res-status-raw` 356, and unscoped writes 250. They only move down, and
   each reduction is locked in by the commit that earned it.

What engineering will **not** do before G1:
- a new door;
- a marketplace or public API;
- residential comps;
- new AI destinations;
- a new vertical;
- multi-region infrastructure;
- a native app store release. The PWA is enough; Capacitor stays scaffold.

## 6. The scoreboard for this plan

| Metric | Now | Phase 1 target | G1 target |
|---|---|---|---|
| Paying customers | 0 | 0–5 (partners) | 25 |
| Median signup → first mail | unmeasured (time-to-aha 7:30) | ≤30 min (witnessed) | ≤10 min (unwitnessed) |
| Restore drill | never run | passed once | passes weekly |
| Deploys blocked by security/lint gates | 0 (not wired) | wired | wired |
| DNC scrub | allows all | live, fail-closed for cold | live |
| Founder pages / week | n/a | measured | < 2 |
| Gross margin | unmeasured | measured | ≥70% |
| Registry OPEN P1 | 1 (0143) | 0 | 0 |
| Cross-tenant defects found per audit cycle | 2 this cycle (0179, 0183) | trending to 0 | 0 across 2 consecutive cycles, with RLS live |
| Unscoped org-table writes (ratchet) | 250 | ≤150 | ≤50, with RLS on the rest |

## 7. 🔑 Founder decisions this plan needs, in order

1. Provision the Phase-0 secrets (table 0.1). This is one sitting.
2. Document storage backend (0143/0046).
3. DNC vendor go-live, and the legal read on servicing-text scope.
4. Parcel/sales-data licence for the launch counties (#14 / H0 §6.2).
5. LLC formation, EIN, registered agent, and counsel review of the Terms,
   Privacy Policy and disclosures.
6. The borrower-debit policy after an org cancels (0106), and the late-fee
   ledger design (0099).
7. The seller life-event signals (divorce, health, retirement) after legal
   review (0178).
8. A qualified tax reviewer for 1099-INT (0101). No date is needed; it
   stays refused until then.
9. List pricing at GA (memo 2026-07-08).

## 8. The first 30 days

- **Week 1:** the Phase-0 secrets are provisioned. The deploy gate is
  wired. Jobs are pinned to the worker. The landing claim is corrected.
- **Week 2:** the restore drill passes. The wedge E2E is green in CI. The
  storage decision is made and 0143 is fixed. DNC is live.
- **Week 3:** the first two design partners are onboarded and watched
  live. The funnel view is in The Letter.
- **Week 4:** the list builder ships (if the licence is decided) or the
  honest import path is polished (if not). Partners three to five are
  onboarded.
