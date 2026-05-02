# Talia Ozborne — Bank Partner Audit

**Reviewer:** Talia Ozborne, 39, SVP Business Banking, regional bank ($14B AUM, 6-state footprint)
**Lens:** referral mechanics, customer-data sharing (with consent), co-marketing economics, bank-grade compliance, embedded banking opportunity
**Date:** 2026-05-01
**Wave:** 3 — elite-team-deeper

---

## TL;DR for the SVP committee

AcreOS has a clean, vertical-specific customer base (Land Investors) that maps almost perfectly to our small-RE lending and business-banking ICP. The technical foundation is partner-ready in the dimensions that matter to a regional bank — AES-256-GCM field encryption, TCPA consent capture per-lead, audit logging on compliance-relevant actions, Dodd-Frank checker, structured logging. The product is **not** partner-ready in the dimensions that matter to a partner-program manager: there is no partner-tier above the user-to-user referral system, no co-branded landing-page/UTM infrastructure, no consented data-sharing surface (a "share my deal flow with my banker" toggle), no embedded-banking primitives (deposit account linking, ACH origination, loan-app handoff), and no revenue-share ledger separable from the user-credit ledger. The opportunity is large — I would price a 3-year exclusive at $4–6M guaranteed plus rev-share — but the integration must be built; it does not exist yet.

---

## 1. Existing referral mechanics (what's there, why it doesn't fit a bank)

**Code surface:** `server/routes-referral.ts` + `shared/models/auth.ts` (referrals table, users.referralCode, organizations.referralCredits).

**What it does today:**
- Each user gets an 8-char alphanumeric code (`crypto.randomBytes(5).toString("base64url").slice(0,8).toUpperCase()`).
- Three states: `pending` → `signed_up` → `converted` (converted = referee hits `deal_won`).
- Reward: $1.00 credit (literally `creditAmount = 100` cents) to **both** sides on conversion. Comment says "or 1 month free depending on plan" — the code applies cents.
- Stats endpoint exposes signups, conversions, credits earned, credit balance.
- Apply endpoint requires both code + refereeId and is `isAuthenticated`-gated, meaning the referee has to already be signed in — there is no anonymous landing-page → signup → attribution path I can see.

**Why a bank can't use this as-is:**
1. **Single-tier, peer-to-peer.** A bank partner is not a user — we are an institutional referrer. The schema has no `partner_id`, no partner table, no concept of a non-user referrer. Talia's bank cannot get a code without spawning a fake user account.
2. **$1 reward.** The conversion event pays $1.00. Fine for viral user-to-user. Useless for a partner program where I am sending a $400K SBA loan or a $2M deposit relationship.
3. **Referee must already be authenticated to apply.** This means the referee has to sign up first, then somehow remember to enter our code. No `?ref=` cookie pickup at landing, no last-touch attribution on signup. (Code comment claims "after a new user registers if they came via ?ref=CODE" but the route requires `isAuthenticated` and a `refereeId` — implementation gap.)
4. **No revenue-share ledger.** `referralCredits` is a single integer column on `organizations`. There is no separate partner-payout ledger, no 1099 tracking, no Reg O / RESPA Section 8 anti-kickback safety net (more on this below).
5. **No territory or vertical scoping.** A bank partner needs "only customers in CO, KS, NM, OK, UT, WY count toward my deal" — there is no geo-filter on the conversion event.

**Verdict:** the referral system is a viral growth feature, not a partner platform. To onboard a regional bank, AcreOS needs a parallel `partners` surface.

---

## 2. Customer-data sharing (with consent) — the gap that matters most

This is the single biggest blocker. A bank partnership is worth ~10x a marketing-affiliate deal because of **data**: I want to see, with the customer's explicit consent, the deal pipeline of every AcreOS user who opts in, so my relationship-bankers can reach out at the right moment (loan-application stage, post-acquisition working-capital need, pre-closing escrow).

**What exists:**
- `tcpaConsent` and `doNotContact` boolean fields on leads (verified: `server/ai/tools.ts:1556`, `1602`; `services/tcpaCompliance.ts` — referenced but checked for **outbound** comms by AcreOS, not for third-party sharing).
- `auditLogEntry` infrastructure (verified: `routes-compliance.ts:59`).
- AES-256-GCM field encryption middleware (`server/middleware/fieldEncryption.ts`) — production-grade.
- Webhook dispatcher (`server/services/webhookDispatcher.ts`) — exists but I haven't seen a partner-scoped subscription model.

**What is missing:**
1. **No "share with my banker" consent primitive.** There is no per-customer toggle that says "AcreOS may share deal-stage events, parcel addresses, and offer amounts with [Partner Bank Name]." TCPA consent is for AcreOS contacting the lead, not for AcreOS sharing the lead with a bank.
2. **No partner-scoped webhook subscriptions.** Webhooks today are org-internal (CRM-style). A partner-scoped webhook would be: "for every org that has consented to share with partner=X, fire event Y to URL Z, with HMAC signed by partner-secret."
3. **No data-sharing audit log.** Banks need a per-record "we shared field F of record R with party P at time T because consent C was active" log to answer GLBA Privacy and CCPA/CPRA right-to-know requests. The audit_log table can be extended for this, but no schema entry currently exists for `external_share` actions.
4. **No GLBA Notice surface.** If AcreOS becomes a "service provider" or "joint marketing" partner under GLBA, there is a privacy-notice obligation. Nothing in the current onboarding flow asks the user to acknowledge sharing with a named bank.
5. **No data minimization layer.** When/if sharing is added, the bank should receive only what's needed — name, email, phone, deal-stage, geography — not raw notes/uploads. Today there is no field-level allow-list for outbound sharing.

**What good looks like:**
- New table `partner_data_consents` (org_id, partner_id, scope[], granted_at, revoked_at, evidence_blob).
- New table `partners` (id, name, type='bank'|'lender'|'insurer'|'title', territory[], rev_share_pct, hmac_secret_encrypted).
- New `partner_share_audit` table appended on every outbound payload.
- Per-customer settings page: "Connections → My banker (AcreOS Bank Partner): [✓] Share deal pipeline. [✓] Share offer amounts. [ ] Share parcel notes. [Revoke]"
- Partner-scoped webhook subscription with replay/HMAC.

---

## 3. Co-marketing economics

**Current state:** Nothing is built for this. There is no co-branded landing page, no UTM-aware signup flow, no partner-attributed plan, no shared cohort dashboard.

**What I'd want my marketing team to require:**
- **Co-branded landing page** at `acreos.com/[partner-bank-slug]` that survives a refresh and stores `?ref=BANK&utm_*` in a 30-day cookie before signup. Today the landing repos (`acreos-landing/`, `acreos-onboarding/`) are present but I see no partner-templating.
- **Partner-attributed pricing.** "Get 90 days free as a [Bank] customer" requires a coupon-like primitive scoped to a partner code. Stripe service exists (`server/stripeService.ts`) — coupons are easy to wire, but the partner→coupon mapping does not.
- **Shared cohort analytics.** Partner-side dashboard showing: signups attributed, activation rate, deals-won, gross-revenue attributed, dollars sent to partner via referral. A `partners.routes.ts` with `/api/partners/:id/cohort` would be the surface.
- **Co-marketed in-app surface.** "Need acquisition financing? [Bank] is our preferred lender" tile on the deal-detail page, with a one-click handoff. This would slot near the existing `routes-deal-underwriting.ts` and `routes-borrower.ts` surfaces but does not exist.

**Pricing model I'd propose to AcreOS:**
- **CAC-based attribution.** $250 bounty per qualified signup (Plus tier or higher, retained 60d).
- **Rev-share on closings I touch.** 25 bps on loan principal we originate to AcreOS-attributed customers; 5 bps on AcreOS-tier upgrade revenue (3 yrs).
- **Guaranteed minimum.** $1.5M/yr × 3 yrs against rev-share, prepaid quarterly.
- **Exclusivity.** Category-exclusive (regional banks ≤$50B AUM in our 6-state footprint) for the term.

That economic model **cannot be reported on** with today's plumbing. There is no partner-attributed-revenue field on `organizations`, no per-deal partner stamp on `notes`/`payments`.

---

## 4. Bank-grade compliance — what our partner-program demands

This is the section where my Risk and Compliance officers will block deal closing if not addressed. Each item below is a contractual prerequisite.

| Requirement | Status in AcreOS | Gap |
|---|---|---|
| **SOC 2 Type II** report | Not visible in repo. SECURITY.md exists. | Need attestation letter + most recent report. |
| **Encryption at rest (AES-256)** | ✅ `middleware/fieldEncryption.ts` AES-256-GCM; backups `ServerSideEncryption: "AES256"` (`jobs/dbBackup.ts:60`). | None. |
| **Encryption in transit (TLS 1.2+)** | Implied by Fly.io + Cloudflare per `MEMORY.md` infra. | Need formal cipher-suite policy doc. |
| **Vendor risk questionnaire (SIG Lite)** | Not built. | Need a one-shot exec-summary doc. |
| **GLBA Safeguards Rule** (16 CFR 314) | Partial — encryption + access controls + audit log. | Need named CISO, IR plan, annual risk assessment, board-level reporting. |
| **CCPA/CPRA right-to-know + delete** | Not visible in routes (no `/api/privacy/export`, `/api/privacy/delete`). | Build a self-serve subject-rights surface. |
| **Audit log immutability** | `audit_log` table exists; `routes-compliance.ts:59` writes entries. | Append-only enforcement at DB level (Postgres trigger or WORM bucket) not verified. |
| **TCPA consent retention** | `tcpaConsent` boolean per lead; check in `services/tcpaCompliance.ts`. | Should retain consent **evidence** (timestamp, IP, source URL, exact wording shown), not just a boolean. |
| **Dodd-Frank seller-financing checker** | ✅ `routes-dodd-frank.ts` + `services/doddFrankChecker.ts`. | Excellent. Bank legal will love this. |
| **RESPA Section 8 anti-kickback** | Not addressed in code. | If we are paying for *referrals of mortgage business*, RESPA §8 prohibits unearned-fee splits. The rev-share model needs structuring as a **bona-fide marketing services agreement** (MSA) with FMV documentation, not a per-referral kickback. |
| **Reg O / Reg W** (insider lending, affiliate transactions) | N/A unless AcreOS becomes a bank affiliate. | Document non-affiliate relationship in MSA. |
| **OFAC screening** on shared customer data | Not visible. | Bank needs assurance that AcreOS at least screens by name+DOB on KYC events, or hands raw data and lets bank screen. |
| **BSA/AML monitoring** | `services/amlMonitor.ts` exists. | Verify scope — at minimum, large-cash transaction structuring detection for note-payment surface. |
| **Right to audit** | Not contractual. | Bank's standard DPA includes 30-day audit-on-notice; AcreOS needs to accept. |
| **Subprocessor disclosure** | Not visible. | Need a public list (Clerk, Fly.io, Cloudflare, Stripe, Anthropic, etc.) and notification SLA on changes. |
| **Cyber-insurance** | Not visible. | $5M minimum required by most regional banks for partner contracts. |

**Critical from Talia:** the RESPA §8 issue is not theoretical — it's the reason most fintech-bank referral deals get restructured. AcreOS legal should review whether any partner-attributed flow involves a federally-related mortgage loan; if yes, the rev-share must be MSA-structured (paying FMV for marketing services rendered) rather than per-closing.

---

## 5. Embedded banking opportunity — where this gets exciting

This is where AcreOS goes from "we send each other leads" to "we are the financial layer of the Land Investor stack." Three tiers of integration, in order of effort:

### Tier 1 — Co-marketed handoff (4-6 weeks)
- "Apply for acquisition financing" CTA on deal pages → pre-fills bank loan-app via signed JWT containing pre-consented buyer data.
- Status webhook back to AcreOS so deal-stage advances when loan funded.
- Existing surfaces to reuse: `routes-deal-underwriting.ts`, `routes-borrower.ts`.

### Tier 2 — Linked accounts (3-4 months)
- "Connect bank account for note-payment auto-debit" — Plaid/Finicity link in borrower portal (`routes-borrower.ts` already has session auth via cookie + IP-rate-limited payment endpoint).
- ACH origination on the AcreOS-side note collection (today payments exist as a `payments` table per `routes-borrower.ts:5`); routing it through partner bank's ACH rails is a backend swap.
- Deposit-account opening from inside AcreOS for new orgs ("open your business operating account").

### Tier 3 — Embedded credit + treasury (9-12 months)
- **Working-capital line** for active investors based on AcreOS deal history (the ML valuation model at `server/ml/valuation_model.py` produces underwriting-grade signal).
- **Earnest-money escrow** custodial accounts opened automatically per deal.
- **Card issuance** for due-diligence spend (title fees, surveys, drone, Recorder).
- **Sweep account** on `referralCredits` and platform-fee balances.

The technical preconditions are mostly present — AES-256 encryption, structured logging, audit log, webhook dispatcher, Stripe service, AML monitor, Dodd-Frank checker. What's missing is the partner abstraction layer. Once that's built, Tier-1 is a quarter of work and Tier-3 is a roadmap.

---

## 6. What I would do if I were running AcreOS partnerships

**Sprint 1 (2 weeks):** Build the `partners` table, `partner_data_consents` table, and a partner-scoped variant of the existing referral routes. Make `routes-referral.ts` capable of handling a non-user referrer.

**Sprint 2 (2 weeks):** Co-branded landing template + UTM/ref cookie persistence + Stripe partner-coupon mapping. Land the BNY/regional-bank vertical first because their compliance bar drives the rest.

**Sprint 3 (3 weeks):** Customer-facing "Connections" settings page with granular consent toggles. Outbound webhook subscription per partner with HMAC + replay + share-audit log.

**Sprint 4 (4 weeks):** Tier-1 embedded handoff to first bank partner. SOC 2 Type II window opens; commission a third-party pen-test report; publish subprocessor list.

After Sprint 4, AcreOS has something I can take to my Risk Committee and close.

---

## 7. Specific code-level findings I'd flag to engineering

- **`server/routes-referral.ts:24,65,148,209`** — uses `(req.user as any)?.id`. CLAUDE.md project standard says use `AuthenticatedRequest` + helpers. Tight, easy fix; matters because partner-program code will inherit this file's patterns.
- **`server/routes-referral.ts:24,27,etc.`** — raw `res.status(401).json({ message })` instead of the project-mandated `Errors.unauthorized(res)`. Same standards drift.
- **`server/routes-referral.ts:162`** — `creditAmount = 100` (cents). Comment says "or 1 month free depending on plan" but logic is hardcoded. Either delete the comment or wire plan-aware reward — banks will ask "what does your referral system actually pay" and the answer should be deterministic.
- **`server/routes-referral.ts:98`** — `POST /apply` requires `isAuthenticated` and a `refereeId` in the body. If the intent is "called after a new user registers," it should accept a server-trusted post-signup hook (e.g., from Clerk webhook) rather than requiring the freshly-registered user to authenticate and self-report. Today there's a window where attribution silently fails.
- **`shared/models/auth.ts:159` referrals table** — has `referrerId`, `refereeId`, `code`, `status`, `creditAmount`, `convertedAt`. Missing: `source` (URL/UTM), `attribution_window_days`, `partner_id` (nullable FK). Add these now to avoid a painful migration later.
- **`server/routes-borrower.ts:18`** — borrower portal session in cookie or `x-borrower-session` header, 24h expiry, IP-based rate limit. This is the natural surface to extend with "linked bank account" + "loan-app handoff" — clean enough that I'd let my engineers integrate against it.
- **TCPA consent stored as boolean.** Strengthen to evidence-bearing record (timestamp, IP, exact wording, source URL) before any data-sharing partner deal — banks will ask.

---

## 8. The deal I would actually offer

- **Term:** 3 years, category-exclusive (regional banks ≤$50B AUM, 6-state footprint).
- **Guaranteed minimum:** $1.5M/yr × 3 = $4.5M, prepaid quarterly.
- **Variable:** $250 per qualified signup + 25 bps on loan principal we originate + 5 bps on AcreOS subscription rev attributed.
- **Co-marketing fund:** $400K/yr each side (matched), governed by joint marketing committee.
- **Exit ramp:** if AcreOS hits SOC 2 Type II + ships Tier-1 embedded handoff within 12 months, multiplier on rev-share converts from 25 → 35 bps for years 2-3.
- **Hard-no conditions:** no SOC 2 Type II report by month 9 → terminable at par; any incident involving customer financial data → 30-day cure window then terminable.

Reasonable for both sides. Bank gets vertical-exclusive distribution into a high-LTV ICP; AcreOS gets revenue floor + capital partner + credibility for raising the next round.

---

## 9. Bottom line

AcreOS is **technically ready** for a bank partnership at the foundation layer (encryption, audit log, structured logging, Dodd-Frank, AML monitor). It is **product-not-ready** at the partner-program layer (no partner abstraction, no consented sharing, no co-branded surfaces, no rev-share ledger, no embedded-banking primitives). The build to get there is 8-12 weeks of focused work. The economic upside — vertical-specific Land Investor banking — is large enough that a regional bank will pay a guaranteed minimum to reserve the seat. AcreOS should build the partner platform before the first conversation, not during it. Walking into a Risk Committee with Tier-1 handoff already shipped doubles the deal value.

— Talia
