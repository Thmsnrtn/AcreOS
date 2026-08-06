# 18 — Solo-Operator Sustainability

**Slice 18. Read-only. Region: the founder-facing operations machine — step-away
readiness (`stepAwayReadiness.ts`), the readiness/setup ladder, vendor-credential
health, spend self-pause (stop-loss / AI cost ceiling), the break-glass card, and
the succession/bus-factor docs.**

The autopilot layer is genuinely strong for a one-person business: signup→onboarding
is fully automated (`onboardingAutonomy.ts`, daily cron, zero per-customer founder
steps), outreach and AI spend both **fail closed** and self-pause (`outreachStopLoss.ts`,
`aiCostCeiling`/`capitalTracker`), and the step-away surface is machine-verified, not
vibes. So there is very little *recurring* toil by design. **The single defect class that
survives every gate here is the blind spot for time-based failures during an absence:
vendor credentials that expire on a known date, and app-down alarming, are not covered
by the "can I leave right now?" verdict — and one such expiry (ATTOM, ~2026-08-28) sits
squarely inside a two-week absence window starting today (2026-08-06).**

---

### F-18-1 — Vendor-credential EXPIRY is monitored by nothing; a known dated lapse (ATTOM 2026-08-28) will degrade the product mid-absence with zero warning
**Severity:** P1 serious
**Surfaced by:** slice 18
**Survives which gates:** No ratchet, lint, or test covers external-vendor credential lifetime. `vendor-health-probe.mjs` exists but (a) is **presence-only** for paid vendors — it checks the key is *set*, never that it still *works* or when it *expires* (`scripts/vendor-health-probe.mjs:122-141`), and (b) is **never scheduled** — its only invocations are a manual `workflow_dispatch` remediation job (`.github/workflows/ses-dkim-fix.yml:48-49`) and the laptop-driven `founder-recovery` kit. The reachability ratchet catches "built but unwired" code, not "credential silently lapsed." The step-away verdict (below) never reads it.
**Evidence:**
- `docs/company/live-operation-keys.md:46` — ATTOM is on the "**API Free Trial (30 days)** plan, so it lapses on/around **2026-08-28**."
- `:49` — ATTOM is the **sole routed source** for residential comps; confirmed in code: `server/services/residentialComps.ts:50` `RESIDENTIAL_CAPABLE_PROVIDERS = ["attom"]` (no land-comp fallback by design) → `:74` degrades to `status: "unavailable"`.
- `scripts/vendor-health-probe.mjs:124` — ATTOM is in the `presenceOnly` list: even a manual run reports only `SET`, so it **cannot detect the trial lapse** (the key stays set; ATTOM starts returning 401/403).
- Repo-wide search for any vendor-credential expiry/renewal field (`expiresOn|trialEnds|renewalDate|renewal_deadline` over server/shared/scripts) returns only *customer* `trialEndsAt` rows — **no vendor-credential expiry tracking exists anywhere.**
**What's wrong:** The one dated, self-inflicted vendor deadline the founder already knows about lives only as prose in a doc. No job counts down to it, no page fires on it, and the health probe is structurally incapable of seeing it. On ~2026-08-28 residential comps flip to "unavailable" — honestly (no fabrication), but a real product regression that moved `fix_and_flip` roadmap→beta. mature-machine §5.2 (vendor health probe + spend monitor + documented failover seam per external dependency) and §5.5 ("state-license renewal deadman") are unbuilt for the expiry dimension.
**Impact:** Burns trust after sale — a customer running a fix_and_flip comp during the lapse hits a dead capability with no explanation to the founder (who is away). Today, zero customers, so the immediate blast is low; the *class* compounds as every added vendor (Regrid, Searchbug DNC, the nationwide parcel bet) brings its own trial/renewal clock into the same blind spot.
**Fix:** Add a `vendor_credential_expiry` table (or a `founder_settings` list) of `{ vendor, envVar, expiresOn, isSoleSourceFor }`, seed it with ATTOM 2026-08-28. Add a daily job (reuse the autopilot senses cadence) that pages the founder at T-14/T-7/T-2 days via the existing pager, and add the same countdown as a `ReadinessCheck` in `stepAwayReadiness.ts` (the delegation check at `:223` already models an expiry countdown — copy that shape). Optionally make the probe *live-check* ATTOM once/week (a single free metadata call) so an already-lapsed key is caught even without a recorded date.
**Gate it:** A ratchet on the expiry registry: `scripts/ratchets/vendor-expiry.json` asserting every entry in `RESIDENTIAL_CAPABLE_PROVIDERS`/`allowProviders` single-source lists has a corresponding expiry row (baseline: today **0 rows exist**, so the ratchet starts by requiring ≥1 for ATTOM). Plus a step-away readiness check so the verdict can never say "every system armed" with an expired sole-source key.
**Effort:** M (<1d)
**Blast radius:** new small table/setting + one daily job + one readiness check; `stepAwayReadiness.ts`, `residentialComps.ts` (read-only reference).
**Confidence:** high — the expiry date, the sole-source config, and the probe's presence-only nature are all cited directly. What would raise it further: confirming no *out-of-repo* calendar reminder exists (not knowable from the repo).

---

### F-18-2 — The step-away verdict verifies the IN-APP pager but never the EXTERNAL watchdogs, so "you can step away, every system armed" can be true while a mid-absence app outage has no outside-in alarm
**Severity:** P2 real
**Surfaced by:** slice 18
**Survives which gates:** No test asserts consistency between the two founder-readiness surfaces. The step-away surface gates its verdict on eight checks — panic stop, paging channel, loop health, release freshness, budget, delegation, dead-letters, immune motor (`server/services/autopilot/stepAwayReadiness.ts:55-280`) — none of which is "are the external GitHub-side watchdogs armed?" The setup *ladder* has a `watchdogs` rung (`server/services/founder/readinessLadder.ts:230`, `measureWatchdogs` `:708-757`), but it is a separate surface the founder may never re-open, and it needs a connected GitHub host to read the Actions secrets at all (`:721`).
**Evidence:**
- `stepAwayReadiness.ts:82-98` — the paging check verifies an **in-app** ntfy topic + email fallback. But the app's pager cannot fire when the app itself is down.
- The two workflows that *can* alarm when the app is dark are dormant by default: `uptime-probe.yml` ("DORMANT until two repo secrets are set") and `release-watchdog.yml` (hourly). Their arming is explicitly deferred: `docs/company/founder-decisions-2026-07-28.md:82` decision 8 — "SCAFFOLD NOW, FOUNDER PROVISIONS LATER … the watchdog secrets remain unprovisioned."
- The only always-on external signal is `daily-pulse.yml` (cron `7 11 * * *`) — **once a day**, and it *reports* a health code in one line; it does not threshold-alarm. So an 8am outage during an absence is invisible until up to ~23h later.
**What's wrong:** The founder's decision surface for "is it safe to leave?" checks the alarm that can't fire in the one scenario absence most needs alarmed (app down). The out-of-app watchdogs that *can* fire are dormant-by-default and the step-away verdict doesn't look at them, so it can read "every system armed" while outside-in outage detection is entirely absent.
**Impact:** Burns trust after sale / neither (pre-revenue) — during a two-week absence a wedged Fly machine or failed deploy stays dark for up to a day before the pulse hints at it; a customer would notice before the founder does. Deliberately founder-deferred, so partly a provisioning gap, not purely a code defect.
**Fix:** Add a non-critical `ReadinessCheck` to `stepAwayReadiness.ts` that calls the same `measureWatchdogs` probe the ladder uses and reports "outside-in outage alarm: armed / dormant." Do not silently upgrade it to critical — keep the honest "optional" framing since the founder chose to defer it — but make the step-away verdict *name* the gap instead of omitting it.
**Gate it:** A unit test asserting every safety dimension in the setup ladder that concerns *unattended* operation (paging, watchdogs) also appears as a check key in `stepAwayReadiness`. Baseline: today the ladder has a `watchdogs` rung and step-away has **0** watchdog check.
**Effort:** S (<2h)
**Blast radius:** `stepAwayReadiness.ts` (one check), one test.
**Confidence:** high — both surfaces read directly; the omission is verified by grep returning zero `watchdog`/`UPTIME_PROBE` references in `stepAwayReadiness.ts`.

---

### F-18-3 — The bus-factor artifact named "Owner's Manual" is a 2,196-line CUSTOMER product tour, not the founder/estate operations manual §5.7 requires — a successor searching for "how do I run or sell this" finds a feature guide
**Severity:** P3 minor
**Surfaced by:** slice 18
**Survives which gates:** No gate checks that a doc's content matches its name or that the §5.7 estate pack exists. The docs-truth concern is slice 17's; the bus-factor consequence is this slice's.
**Evidence:**
- `docs/OWNERS-MANUAL.md` — 2,196 lines; TOC is Leads / Properties / Deals / Finance / Marketing / AI Agents / Team / Billing (`:8-21`); still tells the reader to "Click **Continue with Replit** to authenticate" (`:44`) though Clerk owns auth (`docs/company/live-operation-keys.md`). It is a customer feature manual, last touched 2026-07-16.
- mature-machine.md §5.7 (`:296-306`) requires a **sealed estate pack**: panic stop, Fly/Mercury/Stripe/Clerk access, "the Owner's Manual, sell-vs-run guidance, broker contacts. Tested annually with a verified step-away drill" — a *gate item*, not an afterthought.
- What exists toward it: the **break-glass card** (`docs/runbooks/break-glass-card.md`, outage-only, good) and the `scripts/founder-recovery` kit (dead-key rotation, good). Neither is the succession/sell-vs-run pack; no step-away drill has been recorded (`break-glass-log.md`: "no events recorded yet").
**What's wrong:** The one filename a spouse or successor would open under duress (`OWNERS-MANUAL.md`) delivers a product tour, not "here are the vendor accounts, the money rails, how to keep it running for a month, and who to call to sell it." The estate pack §5.7 calls a gate item is unbuilt; the naming actively misdirects.
**Impact:** Neither (pre-revenue) — but it is exactly the family-clause / bus-factor risk the North Star names as existential to a passive machine. Hurts the founder's household if the founder is incapacitated.
**Fix:** Rename `docs/OWNERS-MANUAL.md` → `docs/CUSTOMER-GUIDE.md` (it is one) and create a real `docs/runbooks/estate-pack.md` seeded from the break-glass card + a vendor-account index (names only, values stay in Fly) + sell-vs-run guidance stub. This is an H4/H5 gate item, so a stub that grows is acceptable now; the rename is the cheap high-value half.
**Gate it:** None possible cheaply for content-vs-name; the honest gate is the §5.7 "tested annually" drill, which is a founder cadence item, not CI.
**Effort:** S (<2h for the rename + stub; the drill is ongoing)
**Blast radius:** two docs; no code.
**Confidence:** high on the mislabel and the missing estate pack; the "no drill recorded" is inferred from an empty append-only log.

---

## Coverage ledger

**Examined exhaustively (read in full or near-full):**
- `server/services/autopilot/stepAwayReadiness.ts` (all 8 checks + verdict logic).
- `scripts/vendor-health-probe.mjs` (all probe branches; confirmed presence-only for paid vendors, no schedule).
- `docs/company/live-operation-keys.md`, `docs/company/mature-machine.md`, `docs/company/founder-decisions-2026-07-28.md` decision 8, `docs/runbooks/break-glass-card.md` + `break-glass-log.md`, `docs/company/phase-1-launch-runbook.md`.
- `.github/workflows/` triggers for daily-pulse, uptime-probe, release-watchdog, ses-dkim-fix (confirmed which are scheduled vs manual/dormant).

**Examined by sampling:**
- `server/services/onboardingAutonomy.ts` (head + step definitions; confirmed signup→onboarding is fully automated, near-zero per-customer founder toil — a positive, not a finding).
- `server/services/outreachStopLoss.ts` (header + enforcement call sites; confirmed fail-closed monthly $500 self-pause — spend cannot compound silently during absence, a positive).
- `server/services/founder/readinessLadder.ts` (watchdogs rung, measureWatchdogs).
- `server/services/residentialComps.ts` (sole-source ATTOM confirmed).
- Grep sweeps for vendor-expiry/deadman/renewal fields; requiresApproval/needs-human gates.

**Did NOT examine (declared gaps):**
- The AI cost-ceiling / `capitalTracker` internals beyond confirming self-pause exists (cost slice 16 owns depth there).
- County ETL scraper self-healing / manual-run cadence (H3 surface; performance/reliability slices 10/13).
- DNC/Searchbug scrub per-campaign manual vs automated (compliance slice 15 owns this).
- Whether NTFY_TOPIC / watchdog secrets are *actually* provisioned in the live repo (not knowable from source; the code honestly treats them as dormant).
- Any out-of-repo founder reminders/calendar (not knowable from the repo — noted as the confidence ceiling on F-18-1).

## Constitution Collisions

None. Every fix proposed here (an expiry registry + a readiness check + arming existing dormant watchdogs + a rename/estate-pack stub) adds monitoring and honesty, not surfaces: no new nav door, no new AI destination, no marketplace/API, no change to money custody, no autonomous hard-stop. F-18-1's expiry table is a founder-facing setting consistent with the existing dormant-watchdog "nothing shown as armed until it is" pattern; the paging it triggers uses the existing pager. The watchdog provisioning in F-18-2 is the founder's own deferred decision 8, surfaced not overridden.
