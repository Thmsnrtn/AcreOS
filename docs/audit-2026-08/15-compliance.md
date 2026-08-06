# 15 — Compliance (Dimension 15)

**Region state.** The compliance surface is unusually mature for a zero-customer repo: `shared/governance/statuteRegister.ts` is a genuinely honest 31-entry map (29 UNREVIEWED, ratcheted to only shrink), the money-custody and DNC-vendor entries are the only two founder-reviewed, and the individual gates (Reg-Z due-date refusal, non-pyramiding UNIQUE index, TCPA quiet-hours choke point, CAN-SPAM safe-default footer) are real and mostly refuse-not-fabricate. The register's `failureMode` prose is the best compliance documentation in the repo.

**The single defect class that survives every gate here:** *compliance assurances are validated for file-existence, never for truth.* The `statuteRegister.test.ts` ratchet proves every `codeSites`/`refs` path resolves and every `unit-test` entry names an existing `.test.ts` — but nothing checks that the enforcement `note` (e.g. "a single choke point, so no send path can skip it") describes what the code actually does. A false compliance assurance therefore ships green. The concrete instances: a Reg-Z-adjacent FCRA screening write that is gated on UPDATE but wide-open on CREATE, a DNC seam that fails **open** for cold marketing whenever no vendor is set (the default), and SCRA tolling that is accepted and thrown away under a deadline shown as binding.

---

### F-15-1 — POST /api/tenants CREATE writes FCRA consumer-report fields with no permissible-purpose gate (PATCH is gated)
**Severity:** P1 serious
**Surfaced by:** 15-compliance
**Survives which gates:** `tests/unit/fcraPermissiblePurposeGate.test.ts` pins the gate on the *action* (`createSkipTrace` writers) and on the tenants **PATCH** path; the register (`statuteRegister.ts:534`) even labels this "Remaining KNOWN GAP pinned in-test" — i.e. the test *asserts the ungated behaviour* rather than forbidding it. `lint:org-fetch` sees org scoping, not FCRA purpose. So the create path is green everywhere.
**Evidence:** `server/routes-rentals.ts:566-584` — the CREATE handler `db.insert(tenants).values({... screeningCreditScore, screeningHasPriorEviction, screeningHasCriminalRecord, screeningIncomeMonthlyCents ...})` with no attestation lookup. Contrast the PATCH handler 12 lines later, `server/routes-rentals.ts:600-603`, which explicitly computes `isScreeningUpdate` and gates it "behind FCRA permissible-purpose attestation."
**What's wrong:** Credit score, criminal-record and prior-eviction flags — FCRA-regulated consumer-report outputs — can be persisted on a tenant at creation with zero permissible-purpose row on file. FCRA §1681b requires a permissible purpose *and* user certification before such data is obtained/retained; the create door bypasses the certification the PATCH door enforces.
**Impact:** Burns trust / legal exposure after sale — hurts the customer (the operator) and, pre-LLC, the founder personally. FCRA carries statutory damages per consumer and is the classic class-action vehicle; a screening product that records report data with no purpose record is exactly the certifiable class the register warns about at `statuteRegister.ts:538`.
**Fix:** Extract the PATCH path's `isScreeningUpdate` gate into a shared guard and apply it in the CREATE handler: if any `screening*` field is present, require a live FCRA attestation (same call the PATCH path uses) before insert, else `Errors.forbidden`. Strip screening fields from `tenantSchema` for callers without attestation.
**Gate it:** Invert the existing enumeration ratchet in `fcraPermissiblePurposeGate.test.ts` to bound *writers of tenants.screening\** rather than gate-callers: POST `/api/tenants` with a `screeningCreditScore` and no attestation ⇒ `success:false`, no row written. Measured baseline today: 1 ungated writer (this create handler).
**Effort:** S
**Blast radius:** `routes-rentals.ts` tenants CREATE handler; `tenantSchema`.
**Confidence:** high — read both handlers directly; the asymmetry is on adjacent lines.

---

### F-15-2 — Statute-register ratchet validates pointer existence, never claim truth — false compliance assurances ship green
**Severity:** P1 serious
**Surfaced by:** 15-compliance
**Survives which gates:** `tests/unit/statuteRegister.test.ts` checks four things (codeSites resolve, refs resolve, unit-test entries name an existing `.test.ts`, UNREVIEWED count ≤ 29). None open the referenced test to confirm it *exercises* the cited rule, and none compare an enforcement `note`'s behavioural claim against the code. A note can assert coverage the code contradicts and every assertion in the suite still passes.
**Evidence:** The register/headers assert unskippability that T2 (`21-trace-message-out.md`, F-21-1) proved false: `dncScrub.ts:40-42` header — "so no send path (manual, AI tool, autopilot hand, **campaign**) can skip it" — and `statuteRegister.ts:571` (tcpa.quiet-hours) — "a single choke point, so no send path can skip it." The campaign batch calls `client.messages.create` directly (`routes-campaigns.ts:2214`), skipping the choke point. `statuteRegister.test.ts:120-134` only asserts the *test file exists*, so both claims stay green.
**What's wrong:** The register's entire value proposition is "here is code that takes a legal obligation on, and who checked it." When the `note` overstates coverage and nothing re-derives it from behaviour, the register becomes the false assurance it was built to prevent — the same "selected-but-unused" failure class CLAUDE.md's wave-discipline section names, one meta-level up.
**Impact:** Neither blocks sale nor immediately burns trust, but it is the load-bearing miss: it is *why* F-15-1/F-15-3 and T2's P0 all read as "handled." Hurts whoever later trusts the register (founder, counsel at review time).
**Fix:** For each `note` making a "single choke point / cannot skip" claim, add a derived assertion the way `workflowActionHonesty.test.ts` derives live triggers from real emitter call-sites: grep for send primitives (`messages.create(`, `ses.sendEmail`) outside the named choke point and assert zero. Reclassify any note whose claim can't be mechanically re-derived from `unit-test` down to `prose-only`.
**Gate it:** Extend `statuteRegister.test.ts` with a "choke-point claims are derived, not asserted" block; ratchet raw-send-primitive count outside choke points at 0 (baseline today: ≥1, the campaign site).
**Effort:** M
**Blast radius:** `statuteRegister.test.ts`, plus one derivation helper per choke-point claim.
**Confidence:** high — the ratchet source and the falsifying call-site are both read directly.

---

### F-15-3 — DNC scrub fails OPEN for cold marketing when no vendor is set (the default) — "DNC vendor before first cold SMS" has no code enforcement
**Severity:** P2 real
**Surfaced by:** 15-compliance
**Survives which gates:** `dncScrub.test.ts` / `smsGateAndCapture.test.ts` pin the vendor-selected and error states, and the *litigator-always-blocks* rule. The no-vendor path is asserted to return `allowed:true` — the test pins the fail-open as intended. No gate distinguishes "cold marketing" from "transactional" at the no-vendor branch.
**Evidence:** `server/services/compliance/dncScrub.ts:313-315` — `evaluateDncGate(null, …)` returns `{ allowed: true, scrubbed: false }` for *any* input, including `leadMatched:true` (cold marketing). Only the `error` status (line 333-342) fails closed for `leadMatched`; the null/no-vendor status does not. Default is inert: `.env.example:345` `# DNC_SCRUB_PROVIDER=none`.
**What's wrong:** With the shipped default (no vendor), the first cold-SMS campaign passes every number to the carrier with `scrubbed:false` — honest reporting, but the send still proceeds. The federal DNC obligation (47 C.F.R. §64.1200(c)(2)) is unmet and nothing blocks it; the honest `scrubbed:false` is a log line, not a refusal. (This is upstream of, and distinct from, T2's F-21-1 campaign choke-point bypass: even the *good* `sendOrgSMS` path fails open here when no vendor is configured.)
**Impact:** Legal exposure on the first cold campaign (TCPA/DNC $500–$1,500 per number), personal to the founder pre-LLC. Bounded: transactional traffic *should* flow, so fail-open is correct there — the defect is that `leadMatched` marketing is treated identically.
**Fix:** In `evaluateDncGate`, when `outcome === null && input.leadMatched`, return `allowed:false, reason:"no DNC vendor configured — refusing cold marketing send"` (mirror the `error`+`leadMatched` fail-closed posture). Transactional (`leadMatched:false`) keeps failing open.
**Gate it:** Add a case to `dncScrub.test.ts`: `evaluateDncGate(null, {leadMatched:true, hasConsent:false})` ⇒ `allowed:false`. Baseline: currently `allowed:true`.
**Effort:** S
**Blast radius:** `evaluateDncGate` policy branch; one test.
**Confidence:** high — the branch and the default are read directly.

---

### F-15-4 — SCRA tolling accepted and discarded under a redemption deadline shown as binding (knowingly unimplemented, no test)
**Severity:** P2 real
**Surfaced by:** 15-compliance
**Survives which gates:** `scra.tolling-and-rate-cap` is `prose-only` in the register (`statuteRegister.ts:551-553`) — no test covers `redemptionClock.ts`. `state.tax-lien-redemption` is also `prose-only`: the register self-admits "NO TEST covers redemptionClock.ts's deadline arithmetic." The register is honest; the code is unguarded.
**Evidence:** `server/services/redemptionClock.ts:237` — `void input.scraTolling;` (the tolling input is explicitly consumed and thrown away); comment at `:216` — "This function models NONE of that." The schema carries `scra_active_duty` columns and `rmloAdvisor` emits a 6%-cap checklist line, but no code applies any SCRA protection to the computed deadline.
**What's wrong:** For an active-duty servicemember, 50 U.S.C. §3936 tolls the redemption period — the on-screen deadline has not legally run. The clock accepts the tolling flag and discards it, then presents a date; nothing on screen distinguishes "computed" from "legally binding" (register `failureMode`, `:556`).
**Impact:** Legal exposure after sale, most severe class: an operator forecloses/forfeits redemption on a deadline that federal law has tolled. SCRA carries criminal exposure and mandatory attorney fees; the harmed party is a deployed servicemember. Low probability (needs active-duty borrower) × high severity.
**Fix:** Until tolling is wired, `redemptionClock` must refuse to emit a firm date when `scra_active_duty` is true or unknown — return `{ deadline: null, reason: "SCRA active-duty status unverified — deadline not computable" }` and surface that verbatim, not a date. Do not wire auto-tolling silently; that is legal-content work.
**Gate it:** Unit test on `redemptionClock`: `scraTolling:true` (or unverified) ⇒ no firm deadline returned. Converts the entry from `prose-only` to `refusal-path`; lower `UNREVIEWED_BASELINE`-adjacent enforcement mix accordingly (currently prose-only).
**Effort:** M
**Blast radius:** `redemptionClock.ts`; any surface rendering a redemption deadline.
**Confidence:** medium — the discard and the "models NONE of that" comment are read directly; the exact set of surfaces that render the deadline as binding was sampled, not enumerated.

---

### F-15-5 — Deposit-return and lease-notice deadlines are prose-only and untested; two overlapping deposit registries can silently disagree
**Severity:** P2 real
**Surfaced by:** 15-compliance
**Survives which gates:** `state.security-deposit-return` and `state.lease-nonrenewal-notice` are both `prose-only` (`statuteRegister.ts:425`, `:441`) — the register self-admits "NO TEST covers depositReturnRules.ts." Nothing cross-checks the two deposit tables. The absence surfaces honestly ("rule for $STATE not in registry"), but the *encoded* deadlines that ARE present are unverified against statute and against each other.
**Evidence:** `statuteRegister.ts:432` (note on `state.security-deposit-return`) — "TWO overlapping deposit registries exist (`shared/regulatory/depositReturnRules.ts` and `SECURITY_DEPOSIT_RULES` in `server/services/landlordCompliance.ts`). They can disagree, and nothing cross-checks them." Only the `landlordCompliance.ts` copy is covered by `tests/unit/landlordCompliance.test.ts`; `depositReturnRules.ts` and the clock/disposition services on it are untested.
**What's wrong:** A landlord relies on a countdown one registry computed; the other registry (or the statute) says a different deadline. Deposit mishandling is the single most common landlord-tenant claim, and the penalty in most states is forfeiture of the right to withhold anything plus 2–3× statutory damages plus tenant attorney fees (register `failureMode`, `:431`).
**Impact:** Legal exposure after sale to the operator; a wrong deadline on a high-frequency, well-litigated obligation. Not founder-personal unless dogfooded pre-LLC.
**Fix:** Collapse to one deposit registry (keep the tested `landlordCompliance.ts` copy or make `depositReturnRules.ts` the survivor and test it), then add a consistency test in the shape of `usuryConsistency.test.ts` that pins agreement or allowlists a divergence with a reason. This is legal-content reconciliation, not a blind refactor — flag for founder review like the usury four-table consolidation (`statuteRegister.ts:719`).
**Gate it:** `depositRegistryConsistency.test.ts` — for every state present in both tables, assert equal deadlines or an allowlisted, reasoned divergence. Baseline: 2 registries, 0 cross-checks.
**Effort:** M
**Blast radius:** `depositReturnRules.ts`, `landlordCompliance.ts`, deposit clock/disposition services.
**Confidence:** high — the dual-registry admission is in the register; the untested status verified against the file list.

---

## Coverage ledger

**Examined exhaustively (read in full):** `shared/governance/statuteRegister.ts` (all 31 entries, 771 lines), `tests/unit/statuteRegister.test.ts` (the meta-ratchet), `server/services/compliance/dncScrub.ts` gate policy (`evaluateDncGate`/`dncGateForSms`), `server/services/emailService.ts` CAN-SPAM address resolution (`resolveCanSpamAddress`, 60-95), the tenants CREATE vs PATCH FCRA asymmetry in `server/routes-rentals.ts` (559-603, 706-805), the SCRA discard in `redemptionClock.ts` (216-237). Cross-referenced the full T2 message-out trace (`21-trace-message-out.md`).

**Examined by sampling / grep:** `server/services/fcraAttestation.ts` (attestation shape + adverse-action *record* path — confirmed the platform records duty acknowledgement and never itself sends the §1681m notice, which is the correct posture: the operator is the CRA user, `routes-rentals.ts:756-805`), `server/services/compliance/ofacScreening.ts` / `sanctionsListSync.ts` (header-level: explicitly advisory, blocks nothing — register `ofac.sanctions-screening-advisory` is honest), `contactFrequency.ts` and `auditChain.ts` (surface only).

**Did NOT examine:** the per-state *values* in any registry (usury 51-state table, deposit deadlines, lease-notice windows, tax-lien redemption periods) against the actual statutes — that is legal research, out of scope and correctly flagged for attorney review by the register itself; the Reg-Z periodic-statement generator internals (`periodicStatements/*`) beyond the register's due-date-refusal claim; IRS Pub 1220 field positions (register admits hand-transcribed, structurally-checked only); the usury four-table consolidation (register `state.usury-ceilings` self-flags 25 unreconciled conflicts — not re-litigated here). Whether `SEARCHBUG_*` / `CAN_SPAM_MAILING_ADDRESS` secrets are provisioned in the deploy environment is unknowable from code.

## Constitution Collisions

- **DNC fail-open (F-15-3) vs "hard-stops stay founder-only forever" + "fabrication never."** Wiring an automatic outbound send is deliberately founder-territory (RESPA early-intervention respects this: flag, not outreach). The fix here is the *inverse* — refusing a marketing send when no vendor is configured — which strengthens, not violates, that discipline. No collision; noted so the fix isn't mistaken for auto-wiring a send.
- **SCRA refusal (F-15-4) aligns with "fabrication is never acceptable."** Showing a computed redemption date as if legally binding when tolling was discarded is fabrication-of-certainty; refusing the firm date is the constitutional posture. No collision.
- **Founder-personal exposure pre-LLC (context, not a code finding):** `docs/legal/audit-2026-05-31.md:224,334-335` records that the registered-agent CAN-SPAM address and the corporate liability shield both depend on LLC formation ("Before first campaign email is sent" / "before first paying customer"). Every finding above that creates operator legal exposure lands on the *founder personally* until that entity exists. No gate enforces LLC-before-first-customer; that is a process trigger, not code, but it multiplies the severity of F-15-1/3/4 in the pre-formation window.
