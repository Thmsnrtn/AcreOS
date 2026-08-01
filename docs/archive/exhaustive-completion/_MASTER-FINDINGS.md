# AcreOS — Master Findings (Deduped Inventory)

**Date:** 2026-05-01
**Synthesis of:** **211 audits across two waves**
- **Wave A (86 audits)** — `elite-team-2026-05-01/` (12 strategic) + `elite-team-deep-2026-05-01/` (74 deep specialists)
- **Wave B (125 audits)** — `elite-team-deeper-2026-05-01/` (regional + niche archetypes, adversarial/accessibility/bandwidth-constrained users, ecosystem + channel partners, lifecycle ops + end-of-cycle, specialized engineering deep-dives)

**Companions:** `_QUICK-REFERENCE.md` (founder single-page) · `_ACTION-PLAN.md` (sequenced sprints).

This document is the complete, deduplicated, ranked inventory across the full 211-persona audit. Findings flagged by 3+ personas independently are tagged **[CONSENSUS]**; 5+ are **[STRONG CONSENSUS]**; 10+ are **[OVERWHELMING CONSENSUS]**. Every recommendation is tagged with the originating persona(s) so the founder can trace back. Where personas disagree, the synthesis takes a position and explains why. **After this synthesis, AcreOS has the definitive 211-persona audit and never needs to repeat the exercise.**

---

## §0. Executive Summary

AcreOS has done the hard things first and the easy things last. The bones are unusually good for a pre-launch SaaS: a real founder voice on the marketing surface, three named agents (Atlas/Pax/Sophie) implementing a genuine brand belief ("no black boxes, three named coworkers, the operator decides"), Clerk + Cloudflare + Fly.io + native e-sign architecture choices that hold up, a token-disciplined design system, idempotency infrastructure, Postgres field-encryption with a key-rotation helper, CSP per-request nonce, AES-256-GCM with auth tag, Sentry consent gate, a 50-state legal-config scaffold no other LandTech competitor ships, and — Wave B confirms — a `governance_policies` engine with the right DSL shape, an audit-log table real-enough for IRS reconstruction (Phineas), an AVM closed-loop feedback instrumentation real AVM shops have (Rosalind), a Lob/SES/Twilio plumbing that is healthy at the basics, a Capacitor blueprint that is right, and a mobile foundation that is the best in the category.

**What's broken is propagation, not architecture — and Wave B sharpens this in three new ways:**

1. **The propagation gap is wider than Wave A measured.** Six conflicting tier-price tables make every revenue number fiction; the founder voice dies at the auth wall and 95% of empty states/error toasts are 2018 SaaS-template copy; the persona-architecture rule (Pax to customers, Atlas/Sophie to founder) leaks in 8+ surfaces; ~101 AI services bypass `aiRouter.ts`; `mutations.retry: true` is the default; four explicit security/legal P0s ship today; the customer-surface microcopy alternates among three apology shapes; and the design system primitives sit at <25% adoption. **Wave B adds**: hardcoded EIN `00-0000000` trashes every 1099, no annual-billing SKU at all (Magnolia), `embedding_vector` is jsonb with TS-side similarity, no TTS anywhere despite Pax voice mode promised, no pgvector / no real ML / "AI" everywhere is hand-tuned heuristics + LLM (Magnus), no chart-of-accounts (Hilda), `generate1099IntForms` emits 1098-INT shape under 1099-INT name (Olympia), four parallel export systems (Tobiah), four parallel Lob client modules (Stanton), two parallel white-label schemas + middlewares + caches (Cuthbert), single platform-shared SES identity (Eleonora).

2. **Lifecycle ops are at pre-seed maturity.** Wave B Batch 7 surfaces an entire missing class of post-decision surfaces: account-takeover recovery (Asher-Mendoza, Coriander), lockout recovery (Cleo), estate-executor access (Martin), divorce / litigation-hold / court-restricted (Ramona, Saskia, Lazlo, Margolis), monthly close (Lavender), CPA year-end (Hilda), 1099 batch (Olympia), 1031-QI close (Kassidy), probate inventory (Penelope), bankruptcy (Constance, Henrik), IRS audit (Bartholomew, Phineas-IRS), state auditor (Jorge), claims adjuster (Yara), insurance E&O (Cordelia, Augustin), DR drill (Boniface), feature deprecation (Sigfried), migration in/out (Magdalena, Tobiah), reactivation (Renoir), win-back (Indigo), annual review (Persephone), quarterly LP statement (Tristan), cancellation flow (Vesper). **Each is a real customer journey today; AcreOS abandons the file at the moment of greatest financial exposure.**

3. **Persona-archetype mismatch is twice as wide as Wave A measured.** Wave A flagged 8 vertical mismatches (Note, Wholesale, Tax-Delinquent, Fix/Flip, Landlord, Subdivider, Family-Office, Capital-Markets). Wave B adds **30+ regional/niche archetypes** (Cesar TX, Hank AZ, Bryce CO, Marisol-CA, Vivienne NM, June NC, Tom PA, Wyatt TN, Della GA-Timber, Frederick farmland, Manuel ag-CA, Tabitha lakefront, Vesta hunting, Saoirse minerals, Roger water, Quentin cell-tower, Sebastian self-storage, Lila RV-park, Otto pre-development, Ezekiel urban-infill, Pearl quick-subdivider, Wynn owner-occupier, Brendan first-time-buyer, Heng foreign-buyer, Reyna Manila VA, Imelda VA-heavy, Blanco joint-owners, Aniyah tribal/restricted-fee), **8 adversarial/accessibility/bandwidth-constrained personas** (Beck dyslexic, Tobias post-stroke, Mavis older user, Earl low-literacy, Yelena ADHD, Otis old laptop, Hugo rural slow connection, Janetta mobile-only, Devika Android), **7 ecosystem partners** (Adelaide NAR, Reginald MLS, Hartwell title, Stanton Lob, Beaufort auction, Eulalia RON-notary, Iolanda Salesforce, Whittaker data-provider, Talia bank, Brindley affiliate, Lavinia co-marketing, Roxanne conference, Geoffrey podcast, Nadege coach, Garrison reseller, Toren agency), **and 8 institutional non-fits** (Burt TIMO, Frederick ag-REIT, Camille-institutional, Tristan/Preston/Rashad LP-fund, Kassidy 1031-QI, Otto pre-development, Lila RV-park, Saoirse minerals, Quentin cell-tower). The pattern: AcreOS positions correctly to "Land Investors" but ships features that fit only the canonical Land flipper, **and ignores three quarters of the long-tail use cases that produce today's revenue**.

**The highest-leverage 30-day move is the propagation pass + the new lifecycle-foundation pass**: pick one tier-price source of truth, fix the four launch-blocking bugs, wire client-side idempotency keys end-to-end, lint the persona codename leaks, codify the apology pattern, cut `/settings` 17 → 7 tabs, kill duplicate routes, **plus** ship the Cesar §5.069 / Aniyah Indian-Country / Sigfried sunset-date / Eleonora deliverability foundation / Cuthbert DNS-cert automation / Magdalena import-ceiling / Olympia 1099-batch fix / Lavender close infrastructure / Coriander recovery console / Boniface restore drill, **and** kill the hardcoded EIN. Twelve focused weeks moves AcreOS from "great prototype with hidden footguns" to "diligence-defensible Series-A asset across all 211 lenses."

The riskiest thing the team can do is build the next vertical (Note Investor, Wholesaler, Subdivider) before the Land Investor wedge is at $10M ARR — **and Wave B confirms** by adding 8 more institutional non-fits to the explicit-defer list. The cheapest, highest-impact thing the team can do remains: finish the work it has already 90% completed.

---

## §1. P0 — Launch-Blocking Bugs (must-ship-before-customers)

**Now 24 items.** Wave A had 15; Wave B adds 9 new P0s, escalates 5 to higher consensus, deepens specifics on 4. Fix before any meaningful customer pays.

### §1.1 Wave A P0s — preserved (with Wave B confirmations)

| # | Finding | Personas-flagged (A · B) | File:line | Sev | Effort | Recommendation |
|---|---|---|---|---|---|---|
| P0-1 | **Six conflicting tier-price tables across the codebase** — MRR on `/founder-home` is wrong by 45–250% on Pro/Scale; `expansionRadar.ts:55` carries a comment claiming match while disagreeing. **[OVERWHELMING CONSENSUS]** Now also blocks annual-SKU shipping (no `priceYearly` peer). | A: Marisol §1, Tegan §2, Asher §4, Ashok §3, Harlowe §3, Wendell §1, Hassiba §1, Eden §3.6 · B: Magnolia §1, Cassiopeia §1, Lavender §WD-2, Hilda §2, Whitfield §2 | `pricing.tsx`, `storage.ts:3452`, `routes-admin.ts:3293,3373,3685`, `routes.ts:1443`, `agents/revenue.ts:14`, `expansionRadar.ts:55`, `autonomousSalesPipeline.ts:309`, `shared/schema.ts:2937,11361` | 5 | 1d + 0.5d for `priceYearly` | Single `shared/billing/tier-pricing.ts` with `priceMonthlyCents` + `priceYearlyCents` peers. Stripe price-ID nightly recon; CI test fails build if Stripe disagrees. Add `billingInterval` on `organizations`. |
| P0-2 | **R1 — founder-check leaks cross-tenant feature requests** | A: Sam §1 R1, Pelle §3, Liana §3 | `server/routes-admin.ts:465, :485` | 5 | 1h | Replace with `isFounderAdmin`. Regression test. |
| P0-3 | **R2 — signed documents are mutable + no `documentContentHash`** **[STRONG CONSENSUS]** Wave B re-confirms this is the single most-cited E&O scenario: "defective document → buyer/seller suit" prices at $15-120K/claim (Cordelia §2.1). | A: Sam §1 R2, Marguerite §2, Phineas-A, Whitman §1, Hiroko §3.2 · B: Cordelia §2.1, Lazlo §4, Saskia §4, Phineas-IRS §2 | `routes-doc-system.ts:725-753`, `storage.ts:5643` | 5 | 1d | Reject `content` mutations when `existing.status === 'signed'`. SHA-256 `documentContentHash` on `signatures`; persist at sign time. |
| P0-4 | **R4 — 2FA non-functional** + Wave B context: Asher-takeover spent 6 hours destroying an account that "had 2FA available, not enforced," and Augustin (cyber UW) declines this as Subjectivity #1. | A: Sam §1 R4, Pelle §2.7 · B: Augustin Q1, Asher-takeover §3, Cleo §1 | `server/middleware/require2FA.ts:31`, `server/routes-2fa.ts:51-139` | 4 | 1d | Rip the 184+55 lines. Use Clerk's native MFA (TOTP + SMS + backup codes). Gate paid-tier writes behind enforced MFA. |
| P0-5 | **R3 — skip-trace results jsonb stored unencrypted** + Wave B context: Caspian (skip-trace partner) — "AcreOS is two incidents away from our must-terminate list. Sam R3 + Kira A4 together make AcreOS the riskiest land-tech account in our book." | A: Sam §1 R3, Aravind §2.2, Anouk §3, Phineas-A #5, Kira A1+A4 · B: Caspian §1, Augustin Q3, Cordelia §3, Linh §3 | `shared/schema.ts:4531-4560` (`skip_traces.results`), `server/middleware/fieldEncryption.ts:264` | 5 | 2d | Add `skip_traces.results` + `skip_traces.input_data` to `SKIP_TRACE_SENSITIVE_FIELDS`. Encrypt + backfill. |
| P0-6 | **`mutations.retry: true` default + zero client `Idempotency-Key`** **[STRONG CONSENSUS]** Wave B adds Alaric refund-flow specific: pass `Idempotency-Key: refund:${request.id}` on `stripe.refunds.create`. | A: Ines §1.1+§2, Hessam §2.1, Vikram §2, Marisol §1 · B: Alaric §2.3, Magnolia §1 | `client/src/lib/queryClient.ts:329-339`, `client/src/lib/error-utils.ts:57-72` | 5 | 1.5d | Default `retry: false`. Auto UUID `Idempotency-Key` on POST/PATCH. Wire stripe/checkout, credits, e-sign send, campaign send, public sign, **+ refund**, **+ Twilio messages**, **+ campaigns/scheduled**. |
| P0-7 | **`eSigningService.sendForSignature` no row lock** | A: Ines §1.3, Hessam §2.4, Marguerite §2 | `server/services/eSigningService.ts:39-178, :246` | 5 | 0.5d | `SELECT … FOR UPDATE` before external POST; pass `documentId` as provider idempotency key. |
| P0-8 | **Persona-architecture leaks on customer surfaces** **[OVERWHELMING CONSENSUS — 13 personas]** Wave B adds Sigfried (sidebar still links to legacy `/founder-dashboard` with literal "legacy" string), Coriander (impersonation `readOnly: true` is a JSON comment, not enforced anywhere), Lila (AI prompts in `routes-deals.ts:654` literally instruct the AI: *"a platform for LAND investors (vacant rural/raw land — not houses, not commercial)."*). | A: Asher §3+§5, Vesna P0-1+P0-2, Mira §4.7, Hiroko §2.4, Tomás §3 R1, Joaquín §3a, Theo §3.B+§9, Yusuf §1.B, Eden · B: Sigfried §1, Coriander §1.5, Lila §2, Whitfield §3 | many sites | 4 | 0.5d + ESLint guard | Codemod sites; custom ESLint rule banning `Atlas\|Sophie\|Forge\|Sentinel\|Sovereign` literals in non-`/founder*\|/admin*\|/sovereign*\|/data-moat*\|/agent-*` JSX. Audit AI prompts for visible-to-customer leak via tool output. |
| P0-9 | **Twilio inbound SMS no MessageSid replay protection** | A: Hessam §2.2, Ines §5, Kira A2 | `server/services/smsService.ts:401-411`, `shared/schema.ts:1477+10285` | 4 | 0.5d | Unique partial index on `messages(externalId) WHERE externalId IS NOT NULL`. `.onConflictDoNothing()`. |
| P0-10 | **Dropbox Sign webhook no event-level idempotency** | A: Hessam §2.4, Marguerite §2 #5 | `server/routes-elite-features.ts:288-312`, `server/services/eSigningService.ts:243-295` | 4 | 1d | Atomic claim mirroring Stripe. State-machine guard. Pin signed PDF on completion. Fail-closed on missing webhook key. |
| P0-11 | **SendGrid event webhook not implemented** + Wave B Eleonora frames as foundation: also missing DKIM isolation, `List-Unsubscribe`, ARC seal, warmup, per-org reputation. | A: Hessam §2.3, Anouk §3, Kira A4, Olu §4 · B: Eleonora §1, Stanton §3 | (missing) | 5 | 1.5d (SG) + 4d (Eleonora foundation) | `POST /api/webhooks/sendgrid/events` with Ed25519 sig. Persist `email_events` + `email_suppressions`. **Eleonora foundation**: per-org DKIM identities, bounce/complaint feedback loop into `email_events`, `List-Unsubscribe: <mailto:>` + `<https://>` headers on every transactional + campaign send, ARC sealing, IP warmup automation, per-org sender-reputation isolation. |
| P0-12 | **F1 — SSRF via `POST /api/webhooks/test`** | A: Felix F1, Sam | `server/routes-integrations.ts:1702-1730`, `server/services/webhookDispatcher.ts:215`, `server/middleware/fileUploadSecurity.ts:273` | 4 | 0.5d | Mount `validateUrl()`. Post-DNS-resolution re-check. Bind to `undici` agent that rejects redirects to private addresses. |
| P0-13 | **F2 — inbound-email webhook unauthenticated** | A: Felix F2 | `server/routes-inbound-email.ts:32-48`, `server/middleware/csrf.ts:26` | 4 | 0.5d | Verify SES/SNS sig OR HMAC body with `INBOUND_EMAIL_HMAC_SECRET`. |
| P0-14 | **Indirect prompt-injection via inbound email body** + Wave B context: Lazlo identifies the same vector as a *discovery exploit* (every prompt-with-untrusted-data flows into `agent_llm_traces` which is mutable). | A: Nadia-AI §2.A+§2.B, Felix, Theo §5 · B: Lazlo §3 | `server/routes-ai-draft.ts:110`, `server/services/leadNurturer.ts:153-158`, `server/services/complianceAI.ts:290-297` | 4 | 1d | Apply `sanitizePrompt` to `message.bodyText`, `subject`, `lead.notes` before interpolation. Sandbox with deterministic delimiters + "data not instructions" rule. Post-validators on draft. |
| P0-15 | **No invite-token rate limit + plaintext + audit-log echoes token** | A: Pelle G/H/I, Liana §2, Kira A6 | `server/routes-organization.ts:1133-1338` | 3 | 1d | Per-org cap (100/day). SHA-256(token) at storage. Redact from `audit_log.metadata`. Per-user accept rate-limit (10/hr). |

### §1.2 Wave B NEW P0s — surfaced for the first time

| # | Finding | Personas-flagged | File:line | Sev | Effort | Recommendation |
|---|---|---|---|---|---|---|
| P0-16 | **Hardcoded `payerEin: "00-0000000"` and `recipientTin: "000-00-0000"` in 1099-INT generation** — every 1099 AcreOS has ever produced is unfileable. Trashes Bartholomew's audit-readiness, Hilda's January close, Olympia's batch-generation, Martin's estate-executor flow. **[STRONG CONSENSUS]** | Phineas-IRS §3, Olympia §1, Hilda §3, Martin §1, Bartholomew §3, Wendell-A §4, Zerah-A §2 | `server/services/bookkeeping.ts:262, :266` | 5 | 1d | Capture org `ein`, `taxIdType`, `taxAddress`, `legalEntityName` in onboarding. Pull into 1099 generator. CI test: no run produces `00-0000000`. **Plus**: rewrite `generate1099IntForms` to emit a 1099-INT-shaped record (not 1098-INT) — Olympia §1 says current code is wrong on form, parties, and TIN. |
| P0-17 | **Cesar TX §5.069 / §5.072 disclosure absent on contracts-for-deed** — Texas Property Code §5.069 + §5.072 require specific disclosure on every contract-for-deed sale, in 12-point font, with specific language. Without it the contract is *void and unenforceable*. AcreOS happily generates contracts-for-deed in TX without these disclosures. Same gap on TX §5.085 release upon completion. **[STRONG CONSENSUS — same Bloomberg-headline class as NY §307]** | Cesar §1, Marguerite §3.2, Cordelia §2.1, Phineas-A #1, Whitman §2 | `server/services/stateDocumentConfig.ts:361-380` (TX block), `server/services/documents.ts` | 5 | 2d | Block native e-sign dispatch on TX contract-for-deed without §5.069+§5.072 disclosure embed. Add to NY §307 negotiable-instrument block (P1-31). Per-state disclosure registry surfaced to `documentValidator`. UI tag "AI-generated draft — attorney review required." |
| P0-18 | **Aniyah Indian-Country block — `landStatus` enum + LAR overlay required** — AcreOS has zero awareness of trust/restricted-fee land. Will run AVM, generate blind offer, dispatch e-sign on parcels that legally cannot be sold without Secretary of Interior signature. "Confidently incorrect output on highest-risk transactions in my book." | Aniyah §2 | `shared/schema.ts` (properties), data-source-broker (federal-land categories), AVM/blind-offer/auto-doc dispatch | 5 | 3d | `landStatus` enum on properties: `fee / tribal_trust / individual_trust / restricted_fee / fee_within_reservation / off_reservation_trust / unknown`. Default `unknown` not `fee`. BIA Land Area Representation (LAR) shapefile overlay on map. Block downstream auto-AVM/blind-offer/auto-doc when `unknown` or trust status. Red banner. |
| P0-19 | **No annual subscription path AT ALL** — `displayPriceYearly` exists in schema (`schema.ts:11361`) but no Stripe Price object, no upgrade flow, no `subscription_anniversary_date`, no `billingInterval`. Every Series-A diligence question "what % of ARR is annual?" answers "zero." | Magnolia §1, Cassiopeia §1, Hassiba §1 | `shared/schema.ts:2937-3136`, `server/routes-billing.ts:274-338` | 4 | 4d | `priceYearly` peer of `price` in `SUBSCRIPTION_TIERS`. `billingInterval` on `organizations`. Stripe yearly Price objects. Upgrade-to-annual prompts at month 4/9/11. 17% discount. `subscription_anniversary_date` denormalized. |
| P0-20 | **Cuthbert white-label DNS/cert pipeline is a half-built bridge** — `whiteLabelConfigs.customDomain` + middleware that *resolves* domains exists; **nothing issues, renews, or revokes a TLS certificate, validates DNS ownership, or talks to the Cloudflare API**. First reseller pointing `app.acquireland.com` gets a Fly TLS error. Plus **two parallel white-label schemas + two parallel middlewares + two in-process caches** = production foot-gun: domain edited via one path stale in the other for 5 minutes. | Cuthbert §1, Garrison §1, Toren §1, Brindley §1 | `server/middleware/customDomainRouter.ts`, `server/middleware/white-label-domain.ts`, `whitelabel_tenants` + `white_label_configs` tables | 5 | 1w | Pick one schema + one middleware. ACME via Caddy/Cloudflare-Origin-Certs/Lego pipeline. DNS-ownership verification (`_acme-challenge` provisioning helper). Redis pub/sub eviction across machines on tenant edits. Customer-facing CNAME instructions doc. **Or** explicit "white-label is paused" banner. |
| P0-21 | **Magdalena CSV-import ceiling at `MAX_CSV_IMPORT_ROWS = 500` + no comms history + no documents + no tags + no `assignedTo` + no `createdAt` preservation** — REI Pro escapee with 4,200 leads must split into 9 files. 70% of 8 years gets stranded on REI Pro. Migration door is too narrow to fit Operator-tier customers through. | Magdalena §1-§2, Tobiah §1-§4, Iolanda §3 | `server/routes-import-export.ts:18`, `server/services/import.ts`, `server/services/importExport.ts:307-320`, `client/src/components/import-export.tsx` | 4 | 1.5w | Raise cap to 50K rows (chunked + background job). Add `tags` parser to import side. `communications.csv` (CSV import for `messages`/`seller_communications`/`inbox_messages`). `documents.zip` ingest with manifest CSV → `documentAnalysis` rows. Preserve `createdAt` from CSV when present. Preserve `assignedTo`. **Plus** consolidate the four parallel export systems (Tobiah §1) into one canonical archive contract. |
| P0-22 | **Coriander recovery console is a `psql` window** — Asher-takeover spent 6 hours on 9 destructive actions with 0 friction; Cleo locked out for 9 days; Martin can't get into a dead father's account holding 47 active borrower notes. Support engineer must do raw DB writes to revoke sessions, reset 2FA, freeze autopay, transfer ownership. **[STRONG CONSENSUS — 5 personas converge]** | Coriander §1, Asher-takeover §4, Cleo §1, Martin §3, Dorian §2 | `server/routes-admin.ts:929,965,4543,4575`, `server/routes-2fa.ts:151`, missing endpoints | 4 | 2w | Build the recovery console: `/api/admin/users/:id/2fa/reset` (with identity-proof), `/api/admin/users/:id/sessions` + `/sessions/:sid/revoke` + `/sessions/revoke-all-others`, `/api/admin/orgs/:id/freeze-autopay`, `/api/admin/orgs/:id/transfer-ownership` (with court-document upload + review queue), `/api/admin/users/:id/password-reset-link` (gen + audit). Identity-proof workflow: upload form + review queue + tier definitions. Asher-takeover §4 step-7 list is the spec. |
| P0-23 | **No legal-hold / litigation-hold mechanism** — `dataRetention.ts` cron deletes `activity_log` after 90d, `agent_events` 60d, `notification_history` 60d, `ai_telemetry_events` 30d, *blind to litigation*. Saskia is committing spoliation by neglect every night her lawsuit is pending. Lazlo (opposing counsel) treats it as the discovery hammer. Margolis (court-restricted) maps the same primitive to court-ordered read-only mode. **[STRONG CONSENSUS]** | Saskia §1, Lazlo §1-§2, Margolis §1-§3, Ramona §3, Cordelia §3 | `server/jobs/dataRetention.ts`, `shared/schema.ts` (no `legal_holds` table) | 4 | 1w | `legal_holds` table (id, orgId, caseName, caseNumber, attorney, scope-jsonb, enteredAt, releasedAt). Scope-resolution function expanding hold → row-IDs across deals/properties/leads/offers/documents/document_versions/signatures/communications/audit_log/notes/payments/agent_tasks/agent_events. `dataRetention.ts` `LEFT JOIN legal_holds_scope`. Delete-blocker on every storage method. Red banner UI on held records. Audit-log entry + attorney email on attempted-delete. **Compose `legalHold` org state from existing `simulated_actions` primitive** (Margolis §1 — pattern already proven). |
| P0-24 | **Boniface DR drill — never restored, ever** — Postgres restore from snapshot estimated 12-40 min RTO and 24h RPO, **never tested**. Anything in a customer contract today claiming 99.9% / <1hr recovery is a lie. Plus zero ransomware playbook, zero second-region failover plan, zero immutable backup copy. | Boniface §1-§3, Bjorn-A §3-§5, Salma-A §4-§7, Adriana-A §6 | `server/services/dbBackup.ts`, `fly.toml`, missing `docs/runbooks/restore.md` | 4 | 1w (run drill + document) | Run Drill 1 (restore from yesterday's snapshot to `acreos-db-restoretest`) this week. Document RTO/RPO actual measured numbers. Bronze tier (1hr/1hr) committed today. Silver (30/15) by Q3 = +$60/mo. Gold (15/5) at first SOC2 customer = +$354/mo. Ransomware playbook: immutable S3 copy with object-lock, separate-account credentials, written runbook. |

### §1.3 Wave A → escalations (more personas now agree)

These items remain on the P0 list but now show **STRONG CONSENSUS** (5+) or **OVERWHELMING CONSENSUS** (10+) after Wave B:

- **P0-1 (tier truth)** — escalates from 8 personas → 13. Annual-SKU absence (P0-19) is a corollary.
- **P0-3 (signed-doc mutability)** — escalates from 5 → 9. Cordelia underwrites at $15-120K/claim per scenario.
- **P0-8 (persona leaks)** — escalates from 9 → 13. Now [OVERWHELMING].
- **P0-5 (skip-trace plaintext)** — Caspian (the partner himself) flags this with explicit termination warning.
- **P0-11 (SendGrid + deliverability)** — Eleonora widens scope from "implement webhook" to full deliverability foundation.

---

## §2. P1 — Critical-Path Quality (ship in next 30 days)

**Now 67 items.** Wave A had 42; Wave B adds 25 new + escalates several.

### §2.1 Brand voice / microcopy / empty states (Wave A) + Read-aloud / Pax response shape / glossary (Wave B)

| # | Finding | Personas-flagged | File:line | Sev | Effort | Recommendation |
|---|---|---|---|---|---|---|
| P1-1 | **Pricing-page split — operator $199-$1,290 vs prosumer $20-$79.** **[STRONG CONSENSUS]** | A: Asher §4, Tegan §2-3, Marisol §1, Wendell §1, Ana §1, Eden §6, Ashok §3 · B: Whitfield §2, Cyrus §1 | `landing/Pricing.tsx`, `pages/pricing.tsx` | 5 | 1w (decision) | Operator-class. Solo $249 / Operator $499 / Operation $1,290–$1,999. |
| P1-2 | **Three apology shapes coexist; 11 `Please`s; 4 `successfully`; 3 `!`; 8 Title-Case dialog titles** — plus Wave B: error reasons not plain-English (Reyna), Pax response shape is wall-of-text (Beck), glossary tooltips missing on "yellow letter," "decision queue," "pulse," "last touch" (Reyna), Pax voice mode is UI surface with no TTS (Beck, Tobias, Mavis, Tariq). | A: Mira §3-§5, Vesna §3-§4, Hiroko §2-§5, Eden §5, Asher §3+§10 · B: Beck §2, Reyna §2, Tobias §2, Mavis §2, Earl §2, Tariq §1 | many | 4 | 1w | Codify shape: `Couldn't [verb] [noun]. [Reassurance] — try again[, or email thomas@acreos.io].` Plain-English error reasons (provider/credit/field). Pax prompt v2: open with one-sentence headline + 3 bullets max, prose only when needed. **"Read aloud" speaker icon on every Pax response + every long legal doc** (`window.speechSynthesis`, 2 lines of code). Glossary tooltip registry (~30 terms). |
| P1-3 | **Generic `Loading…` in 36 sites** | A: Vesna P0-3, Bavo §4, Naima | many | 3 | 1.5h grep + 4d shape work | Each loader names the noun. `label?` prop on `ListSkeleton`. |
| P1-4 | **35+ ad-hoc `<p>No X yet.</p>` empty states** | A: Tomás §2-§5, Vesna §5, Mira §3.3 | many | 3 | 4d | Three-archetype model (First-Hello / Cleared-Decks / Empty-Filter). |
| P1-5 | **Founder letter on `/why` not linked from `/today`** | A: Asher §5+§7, Ana §1 | `pages/today.tsx`, `pages/why.tsx` | 2 | 0.5d | Footer link from PageShell. |
| P1-6 | **Cancellation flow doesn't earn the FAQ promise + Vesper "Downgrade instead" button literally calls `handleClose`** | A: Asher §7.3, Sigrid §3, Camila §6 · B: Vesper §3 | `cancellation-dialog.tsx` | 3 | 2d | One-click ZIP export + T+12hr Thomas email. **Wire "Downgrade instead" to plan picker with pre-selected lower tier**, not `handleClose`. Use the cancellation-context usage panel as the *retention pitch you didn't make* — surface "would you like to pause for 90 days at $0?" or "Sprout at $19/mo fits your usage." |
| P1-7 | **`/security` page missing entirely** + Augustin (cyber UW) declines without it. | A: Asher §6, Sam §6, Anouk §3, Greta §2, Reza §5 · B: Augustin Q3-Q11 | (missing) | 3 | 1d | Founder-voice document. Honest about SOC2 status. |
| P1-8 | **Curated public `/changelog` missing** | A: Asher §6 · B: Renoir §2 (winback flow has no "what's new since you left" engine fed by changelog) | `pages/changelog.tsx` | 2 | 1d | Stop scrubbing dev log. Biweekly customer-voice changelog. |
| P1-9 | **"Business pulse / 65/100" decorative** | A: Asher §3.2, Wendell §3, Yuna §3 | `pages/today.tsx:741, 1212` | 3 | 1d | One-sentence read-of-the-week. |
| P1-10 | **`/today` first-day empty state incoherent** | A: Vesna P1-6, Tomás §7, Yuna §3, Grace §2 | `today.tsx:606-1229` | 3 | 1d | `<FirstDayHero/>` for zero-data. Hide Pulse/AI-queue when `!hasEverHadData`. |

### §2.2 Reliability + idempotency + correctness (Wave A) + foundation gaps (Wave B)

| # | Finding | Personas-flagged | File:line | Sev | Effort | Recommendation |
|---|---|---|---|---|---|---|
| P1-11 | **Campaign send dedup contract missing** | A: Ines §1.4, Hessam §2.2, Kira A1, Adriana §2 | `server/routes-campaigns.ts` | 4 | 1d | Unique idx `(campaign_id, recipient_id, scheduled_minute)`. Require `Idempotency-Key`. |
| P1-12 | **`error-utils.ts` substring matching `error.message`** | A: Hiroko §4.5 · B: Reyna §2 (plain-English) | `client/src/lib/error-utils.ts:1-97` | 3 | 2h | Status-code classification. |
| P1-13 | **Two encryption modules with two keys + two wire formats** | A: Aravind §3.1, Sam §3 · B: Augustin Q3 | many | 3 | 2d | Pick `fieldEncryption.ts`. Migrate. |
| P1-14 | **47 `setInterval` timers; lock TTL < runtime on 3** | A: Iván §2-§3, Ines §3 | `server/index.ts`, `jobSupervisor.ts` | 3 | 1w | Self-rescheduling `setTimeout`. AbortController. |
| P1-15 | **DB connection pool math fails at burst** | A: Adriana §6, Ines, Elliot §2, Nadia-PG §2-§5, Bjorn §3, Salma §4 | `fly.toml`, `server/db.ts:54` | 4 | 2d | pgBouncer transaction-pooling. App pool 5; pgBouncer 30. |
| P1-16 | **REDIS_URL optional in prod + min_machines 2** | A: Salma §4, Kenji §2, Naima, Pelle E · B: Sigrún §1 (no Redis pub/sub adapter — broadcasts on machine A invisible to clients on machine B) | `server/index.ts`, `routes.ts:509`, `cache.ts` | 4 | 0.5d-1d | Verify Redis prod. Wire Redis pub/sub adapter for `wsServer.broadcastToOrg`. |
| P1-17 | **Sentry: no `release`, no `setUser`, soft-fail source-maps** | A: Naima §2, Reza §4 | many | 3 | 4h | `release: VITE_GIT_SHA`. `setUser({id, organizationId})`. Hard-fail source-map upload. |
| P1-18 | **Client Sentry leaks PII** | A: Naima §3, Anouk · B: Augustin Q18 | `client/src/lib/sentry.ts` | 3 | 1d | Port `maskString` to `shared/pii.ts`. `replayIntegration({ maskAllText: true })`. |
| P1-19 | **No first-party object storage** | A: Salma §4, Marguerite §5 · B: Yara §1 (claims-adjuster needs original EXIF; canvas re-encode on upload destroys forensic chain) | (missing) | 3 | 2d | Cloudflare R2 + signed URLs. Pin original photos with EXIF + SHA-256 hash. |
| P1-20 | **No web-vitals; perf flying blind** | A: Beatriz §1, Reza §4 | `package.json` | 3 | 1d | Install `web-vitals`. |

### §2.3 IA + tax + billing + security hardening (Wave A) + lifecycle ops (Wave B)

| # | Finding | Personas-flagged | File:line | Sev | Effort | Recommendation |
|---|---|---|---|---|---|---|
| P1-21 | **Stripe Tax not enabled** + Wave B: Jorge (TX state auditor) — AcreOS has its own franchise-tax exposure nobody's costed; AcreOS-tool-customers in TX have zero franchise-tax surface. | A: Hana §2, Vikram §2, Marisol §2 · B: Jorge §1 | `server/stripeService.ts` | 4 | 1d + nexus | `automatic_tax: { enabled: true }`. `tax_id_collection`. |
| P1-22 | **Stripe SDK no pinned `apiVersion`** | A: Hessam §2.1, Vikram §2 | `server/stripeClient.ts:77` | 3 | 0.5h | Pin `apiVersion: '2024-11-20.acacia'`. |
| P1-23 | **Sub-processors listed; zero DPAs counter-signed** | A: Anouk §2-§3, Greta, Harlowe §2 #6 · B: Augustin Q6 | `pages/privacy.tsx:§12` | 3 | 2w | Counter-sign with: Stripe, Clerk, Twilio, Lob, OpenAI, Anthropic, Sentry, AWS SES, Cloudflare, Fly.io, Mapbox, OpenRouter. |
| P1-24 | **DSAR endpoints scoped to wrong subject** | A: Anouk §2 · B: Tobiah §1 (four parallel export systems with three scope rules) | `server/routes-gdpr.ts`, `server/services/gdprService.ts` | 3 | 1w | Build the third-party-data-subject DSAR pipeline. |
| P1-25 | **No GPC handling on marketing surface** | A: Anouk §2 | `acreos-landing/` | 2 | 4h | 15-line middleware. |
| P1-26 | **17 settings tabs (post-regroup) — 7 single-component shells** | A: Karri §1-§7, Holm §5, Joaquín §7 | `pages/settings.tsx` | 3 | 1w | Cut to 7. |
| P1-27 | **Duplicate routes — `/pipeline`, `/money`, etc.** | A: Holm §3-§4, Wendell §3, Vesna P1-9, Joaquín §5 | `App.tsx`, sidebar | 3 | 1w | 7 redirects (60-day). |
| P1-28 | **Lead-detail and deal-detail are local-state drawers with no URL** | A: Mei Lin §C, Holm | `pages/leads.tsx:2363`, `pages/deals.tsx:1192` | 3 | 1w each | Convert to routes or sheets with URL sync. |
| P1-29 | **`/maps` plural; "Notifications" + "Communications" peer settings** | A: Holm §2, Joaquín §3a, §7, Karri | `App.tsx`, settings | 1 | 0.5d | `/maps → /map`. Rename Communications → "Sending"; under Integrations. |
| P1-30 | **No content hash + signed-PDF archive + completion certificate** | A: Marguerite §2, Sam §5, Hiroko §3.2, Phineas | `routes-public-sign.ts:96-145` | 4 | 2d | (covered in P0-3) |
| P1-31 | **NY/IL/SC purchase-contract gaps** + **TX §5.069 (P0-17 promoted) + Aniyah Indian-Country (P0-18 promoted)** | A: Marguerite §3, Whitman §2, Trey §2 · B: Cesar §1, Aniyah §2, Cordelia §2.1, Lazlo §1 | `stateDocumentConfig.ts:409` | 3 | 1.5w | (TX + Indian Country promoted to P0; rest stay P1) |
| P1-32 | **Dunning email-only, no SMS/push channel** | A: Marisol §2, Olu §2, Vikram | `server/services/dunning.ts` | 2 | 2d | Add SMS leg + in-app banner. |
| P1-33 | **Charge dispute action — auto-flag only** + Wave B: Alaric §2 — no admin approve/deny endpoint, no idempotency on `stripe.refunds.create`, no `denialReason`, no email in non-English. | A: Vikram §2, Marisol §2 · B: Alaric §2 | `webhookHandlers.ts processChargeDispute`, `routes-billing.ts:783` | 4 | 1.5d (dispute) + 1.5d (refund) | 21-day deadline tracker. Evidence-bundle uploader. Auto-submit T-3. **Plus refund flow** (Alaric): `POST /api/admin/refunds/:id/{approve,deny}`, idempotency key, partial-not-cancel logic, `denialReason`, EN+ES email templates. |
| P1-34 | **Per-org rate limit on `/api/ai*` missing** | A: Ines §5, Sandeep §3, Theo §6 | `server/index.ts:282-342`, `rateLimit.ts` | 3 | 1d | `keyGenerator: req.organization?.id || req.auth?.userId || req.ip`. Daily AI spend cap. |

### §2.4 AI / eval / observability (Wave A) + vector / vision / voice (Wave B)

| # | Finding | Personas-flagged | File:line | Sev | Effort | Recommendation |
|---|---|---|---|---|---|---|
| P1-35 | **Zero eval infrastructure** | A: Theo §1+§2, Sayuri §1-§2, Yusuf §1, Nadia-AI §3 | (missing) | 4 | 3d v0 | Eval harness in `tests/evals/`. 50-prompt golden set. Sonnet-as-judge. PR-blocking. |
| P1-36 | **~101 services bypass `aiRouter.ts`** | A: Theo §1+§4, Sandeep §2, Mateo §3 | many | 3 | 3d | Migrate top 10. |
| P1-37 | **`gpt-4-turbo-preview` (deprecated) used in 4 sites** | A: Theo §1, Yusuf §1, Sayuri §2.3 | `aiTutor.ts:78,93,208,278`, `complianceAI.ts:359` | 3 | 0.5d | Pin every callsite to dated model. CI test. |
| P1-38 | **Compliance disclosure generator: deprecated model + zero post-validation** | A: Theo §2, Sayuri §2.3, Marguerite §3, Nadia-AI §2.D · B: Cordelia §2.1 | `server/services/complianceAI.ts:303` | 4 | 2d | Opus 4.6 + extended thinking. Deterministic post-validator. UI tag. |
| P1-39 | **Cascade quality-check on synchronous hot path** | A: Theo §4, Mateo §3 | `aiRouter.ts:174, :782` | 2 | 1d | Async sample 10%. |
| P1-40 | **Pax executive tool-loop never streams during roundtrips** | A: Mateo §3, Theo §3.B | `server/ai/executive.ts:1104` | 3 | 1.5d | SSE between tool calls. |
| P1-41 | **No prompt caching on Pax executive** | A: Sandeep §4, Theo §3.B, Yusuf §B | `server/ai/executive.ts` | 2 | 0.5d | Anthropic prompt caching. |
| P1-42 | **No per-feature rolling-window cost dashboard** | A: Theo §6, Sandeep §3 | (missing) | 3 | 2d | Aggregate by `org × feature × day`. |
| P1-43 | **NEW — Vector retrieval is jsonb + TS-side similarity** — Sayuri-Vatanen §1: 0.5/5 maturity. `embedding_vector` is jsonb, no pgvector, no ANN, no cosine, no hybrid retrieval, no embedding refresh. Sequential scan death at 50k patterns. | B: Sayuri-Vatanen §1, Anaïs §2 (Layer 5 — pgvector usage downstream but not on Pax retrieval), Magnus §1 (no ML at all) | `dealPatternCloning.ts:480, :475, :709`, `shared/schema.ts:7308` | 3 | 1w | `CREATE EXTENSION pgvector`. Migrate `embedding_vector` from jsonb → `vector(1536)`. IVFFlat or HNSW index. Cosine operator. Hybrid retrieval (BM25 + vector). Embedding refresh job. |
| P1-44 | **NEW — Search infrastructure five-layer mess** — Anaïs §2: tsvector engine `fullTextSearch.ts` + GIN indexes via migration 0010 already built and indexed, **but nothing calls it**. Three palettes still do `.includes()` in JS memory; ⌘K paste-as-query allocates ~3MB/keystroke at 50k leads. Wave-2 plan name-checks `pg_trgm` but extension not installed. Six-line fix to wire Layer 3, not a Day-2 project. | B: Anaïs §1-§3 · A: Anya §8 (proposed pg_trgm but missed Layer 3) | `command-palette.tsx:582-588`, `fullTextSearch.ts`, missing route | 3 | 1d to wire + 1w to add `pg_trgm` | Wire `/api/search` to call `fullTextSearch.search()`. `CREATE EXTENSION pg_trgm`. Add accent-folding + phone normalization. Server-side ranking. |
| P1-45 | **NEW — No TTS / no voice-Pax / no streaming TTS playback / no diarization beyond `idx % 2`** — Tariq §1: C+, right providers picked (Whisper batch, Deepgram streaming, Twilio, OpenAI) but pipelines are hackathon-weekend not voice-product. No wake-word, no barge-in, no language detection, no voice-Pax surface in field-mobile UI. Beck/Tobias/Mavis/Earl/Reuben all flag absence of TTS as load-bearing accessibility gap. | B: Tariq §1, Beck §2, Tobias §2, Mavis §2, Earl §2 · A: Reuben §2 | many | 3 | 30d (TTS Read-aloud button) + 8w (voice-Pax full) | Phase 1: `window.speechSynthesis.speak()` on every Pax response + every long doc. Phase 2: streaming TTS (ElevenLabs or OpenAI tts-1). Phase 3: voice-Pax field mobile, wake-word, barge-in. |
| P1-46 | **NEW — No real ML; "AI" everywhere is hand-tuned heuristics + LLM prose** — Magnus §1: correct call for the data regime but the *naming* is dishonest (`buyerMatchingAIService`, `leadIntelligenceEngine`). Roadmap question is not "when do we add ML" but "are we capturing labels + feature snapshots today that would let us train in 18 months." Currently partially instrumented and silently leaking the most valuable signal. | B: Magnus §1 | many | 2 | 1w (instrumentation) | Capture labels (deal outcomes, AVM-vs-actual already present, lead conversion) + feature snapshots (AVM, market intelligence, lead-scoring features at the time of decision) into `ml_training_snapshots`. Defer model training to month 18+. Rename the misleading "AI" services. |

### §2.5 NEW — Lifecycle ops + recovery + close-of-books (Wave B Batch 7)

| # | Finding | Personas-flagged | File:line | Sev | Effort | Recommendation |
|---|---|---|---|---|---|---|
| P1-47 | **Sigfried deprecation playbook — borrower endpoints have `X-Deprecation-Warning` headers but NO sunset date, NO migration deadline, NO announcement** — textbook "deprecated forever" trap. Plus `/founder-dashboard` (7,369 lines) still linked from sidebar with literal "legacy" string. | B: Sigfried §1-§3 | `server/routes-borrower.ts:286-581`, `client/src/components/layout-sidebar.tsx:851` | 3 | 4d | Atlassian-Stride playbook: announce date BEFORE shipping the warning. Sunset `/api/portal/:accessToken/payment`/`/verify-payment`/`/autopay` at T+90 with hard 410 Gone. Remove `/founder-dashboard` sidebar link this week. |
| P1-48 | **Lavender close infrastructure absent** — WD-2 through WD-7 of monthly close are blocked. No chart-of-accounts, no journal entries, no trial balance, no GL detail, no IIF/QBO export. CFO closes in spreadsheets pulling Stripe directly, marks every figure "preliminary." Fine for 5-person company; **not** fine on the day a Series-A term sheet shows up. | B: Lavender §1, Hilda §2, Hassiba-A §1 | `server/services/bookkeeping.ts:458` (`trust_ledger`) | 4 | 2w | Chart of accounts table. Double-entry framing on `trust_ledger`. Trial balance generator. GL-detail PDF. IIF/QBO journal-entry export. Backfill from Stripe. |
| P1-49 | **No `cancellationSurvey`-to-segment classifier; no reactivation context endpoint; no in-product reactivation hooks; no "what's new since you left" content engine** — Renoir came back 14 months later, was treated as brand-new free user. `eventType: 'reactivate'` exists in schema, never written. | B: Renoir §1-§2, Indigo §2-§4, Konstantin-A | `shared/schema.ts:5503,5520`, `server/routes-billing.ts:723`, missing | 3 | 1w | `/api/subscription/reactivation-context` (last plan, tenure, grandfathered price, what's been added). Cancellation-survey classifier. 4-month-quarterly-annual win-back ladder (current ladder dies at day 60). 6-segment 2D matrix (reason × tier) per Indigo §2. |
| P1-50 | **Asher-takeover incident-response surface — bones present, muscle absent** — no session list, no "sign me out everywhere," no suspicious-login detector, no email-on-new-location, no email-change confirmation step, no exfil alarm on bulk export, no rate limit on `/api/leads/export`. 6 hours, 9 destructive actions, 0 friction. | B: Asher-takeover §3-§4, Coriander §1, Cleo §1, Augustin Q1 | `server/routes-2fa.ts`, `server/routes-admin.ts`, missing | 4 | 2w | (Coriander recovery console P0-22 covers backend; this is the user-facing twin.) `/account/security` with sessions list + revoke. Email-on-new-location. Email-change confirmation step to original address. Rate-limit `/api/leads/export` per-org. Anomaly-detect bulk download bursts. |
| P1-51 | **Eulalia RON (Remote Online Notarization) — zero capability, treated as checkbox attribute** — `notaryRequired: true` on 17 state configs is advisory text, not a gate. Every deed AcreOS dispatches into a notary-required state is paper the operator must take to a third-party notary off-platform; AcreOS doesn't tell them, capture proof, or refuse to mark `signed` without notarization. | B: Eulalia §1, Marguerite-A §3 | `state-documents.tsx:118`, `titleChainService.ts:523`, `eSigningService.ts` | 3 | 4w (build-out) or 3d (hard guard) | Either: build RON (notary-officer flow + identity-proofing pipeline + audio-video recording capture + electronic notary journal + jurisdictional enforcement), OR hard-guard: refuse to mark `signed` in notary-required states without external proof-of-notarization upload. **Pick the guard for now.** |
| P1-52 | **Esther post-closing — 5 of 3,140 US counties supported in `countyRecordingFees.ts`; no recording-package builder; no transfer-tax-affidavit; no instrument-number capture; no rejection workflow; no e-recording integration** — closing fees wrong by 30-100% in many counties; signed PDF that needs to be recorded does not exist as a stable artifact. | B: Esther §1, Hartwell §2-§4, Beaufort §2, Marguerite-A §5 | `server/services/countyRecordingFees.ts`, `closingChecklistGenerator.ts:58-60` | 3 | 6w | Simplifile + ePN dual integration. Recording package builder. Instrument-number capture field on deal. Transfer-tax-affidavit generator per state. Rejection workflow. Post-recording document delivery. |
| P1-53 | **Hartwell title-partner API — zero title-order endpoint, zero inbound-status webhook, zero ALTA-Pillar-2 wire-instructions surface** | B: Hartwell §1-§3, Esther §1, Zephyr §1 | missing | 3 | 6w | `POST /api/title-orders`. Inbound title-status webhook with HMAC. ALTA-Best-Practices Pillar 2 wire-instructions surface (out-of-band confirmation, encrypted PDF, signed). Schedule-B exchange format. |
| P1-54 | **Mireille — no DNC scrub at point of ingest** — `importLeads()` doesn't ask "is this phone on federal DNC?", no provider call, `consent_source` defaults null. Pre-scrubbed list and a Craigslist scrape get same treatment. | B: Mireille §1, Kira-A A4 | `server/services/import.ts` | 4 | 1w | DNC API at ingest. `consent_source = 'imported'` when null. Surface DNC count in import preview. Block sends to flagged numbers with override + audit trail. |
| P1-55 | **Wallis feature flags — no percentage rollouts** — schema comment says `// Future: orgIds, region, percent rollout, etc.` Schema *anticipates* the gap. Single largest delta vs LaunchDarkly. | B: Wallis §1 | `server/services/featureFlags.ts:57`, `shared/schema.ts:11326` | 3 | 1w | Add `audience: { percentage: 0-100, region, tierAllowList, orgIds }`. Deterministic hash-based assignment. |
| P1-56 | **Augustin Cyber UW — declines as currently presented; conditional bind requires 4 named subjectivities cleared in 60d** | B: Augustin §3-§8 | (covered by P0-4, P0-5, P1-23, P0-7 sub) | 3 | covered | Subjectivities map to existing P0/P1 items. Renewal kicker: external pen-test, written incident-response plan, sub-processor inventory + DPAs, document-content-hash on signed records. |
| P1-57 | **Cordelia E&O — conditionally yes for cash-deal wholesalers in 2-witness-free states, conditionally no for seller-financed paper, contracts-for-deed, autonomous TCPA outreach, NY/IL transactions** | B: Cordelia §2 | (covered by P0-3, P0-17, P1-31) | 3 | covered | Five loss scenarios price at $15-300K/claim. AcreOS Inc. liability cap of "12 months paid" caps subrogation at $3,600 — this is a non-starter for E&O at scale; rewrite the master agreement liability allocation before E&O is offered to operators. |

---

## §3. P2 — Tech-Debt + Scale-Readiness (ship before 100 customers)

**Now 71 items.** Wave A had 48; Wave B adds 23.

### §3.1 Type-safety + DX + bundles (Wave A — preserved)

| # | Finding | Sources | File:line | Sev | Effort | Recommendation |
|---|---|---|---|---|---|---|
| P2-1 | **1,410 `as any` + 4 customer-facing dirs excluded from `tsconfig.check.json`** | Reza §3, Olav §1-§3 | `tsconfig.check.json`, server/services/ | 3 | 1w | Visibility CSV in CI. Re-include excluded dirs. |
| P2-2 | **CI lint is theatre** | Reza §2b, Dmitri §3, Olav | `.github/workflows/ci.yml` | 2 | 1d | Hard-fail single source. |
| P2-3 | **Frontend `console.*` discipline broken — 71 calls** | Reza §4, Naima §4 | client/src/ | 2 | 6h | Ship `clientLogger.ts`. |
| P2-4 | **480KB `schema-DV1vCZAN.js` chunk** | Imani §3, Reza §2 | `shared/schema.ts` | 3 | 1d | Split server-runtime + client-validators. Lazy-import map/PDF deps. |
| P2-5 | **Drop `react-icons`** | Reza §1 | `integrations-settings.tsx` | 1 | 0.5h | Inline SVG. |
| P2-6 | **PWA installed but unwired** | Reza §1, Skye §6 · B: Andrei §1 (Capacitor wrap is paper plan; missing `ios/` + `android/` dirs) | `vite.config.ts`, `dist/public/sw.js` | 1 | 3h | Wire PWA OR remove both. **Plus Andrei**: decide on Capacitor (run `npx cap add ios/android`) or hold the wrap as deferred. |
| P2-7 | **Per-page OG tags missing** | Reza §5, Beatriz §6, Dilan §2 · B: Bertha §1 (ASO C-: store listings empty) | `client/index.html` | 3 | 1d | SSR/prerender for marketing routes. |
| P2-8 | **CSS — 16 declared classes nothing renders; chart tokens dead; vibrancy literals** | Renske §2-§6, Tessa §2 | `client/src/index.css` | 2 | 1d | Add `--acr-chart-e/grid/tooltip-bg/border`, `--acr-info`. Convert vibrancy literals. |
| P2-9 | **45 `min-h-screen` literals vs 1 `min-h-dvh`** | Vesna P1-7, Skye §2, Calla §6c | many | 3 | 5min + ESLint | Replace-all on app-shell. |

### §3.2 Database + jobs + webhooks + scale (Wave A) + realtime + multi-machine (Wave B)

| # | Finding | Sources | File:line | Sev | Effort | Recommendation |
|---|---|---|---|---|---|---|
| P2-10 | **Inbox + team_messages missing org-scoping indexes** | Adriana §2, Hessam §2.2 | `inbox_messages`, `team_messages` | 3 | 1d | Add 13 indexes per Adriana §2. |
| P2-11 | **Postgres extensions — none beyond `plpgsql`** | Nadia-PG §2, Adriana §0 · B: Sayuri-Vatanen §1 (pgvector), Anaïs §2.4 (pg_trgm) | (cluster) | 3 | 0.5d | `pg_stat_statements`, `pg_trgm`, `btree_gin`, `pgcrypto`, **`pgvector`**. |
| P2-12 | **Deal-close not transactional + `audit_log` not tamper-evident** | Adriana §3, Sam §4 · B: Lazlo §1 (writable, no hash chain = discovery exploit), Cordelia §3 | `withTransaction` callsites; audit_log | 3 | 2d | `REVOKE UPDATE, DELETE`. Hash-chain rows. `acreos_dba` role. |
| P2-13 | **Annual subscriptions recognized at charge** | Marisol §4, Hassiba §1-§2, Ashok §3 · B: Lavender §WD-3, Magnolia §1 | `webhookHandlers.ts` | 3 | 4d | `deferred_revenue` table. Recognition worker. |
| P2-14 | **Subscription-tier mutated in place** | Marisol §1, Hassiba §1, Ashok §3 · B: Magnolia §1 | `organizations.subscription_tier` | 3 | 3d | Immutable `subscription_history`. MRR = view. |
| P2-15 | **No customer-concentration alert** | Marisol §3+§5, Ashok §4 | (missing) | 3 | 1d | >15% alert, >25% hard alert. |
| P2-16 | **NRR not decomposed** | Marisol §3, Ashok §4, Konstantin | many | 3 | 2d | Compute NRR/GRR/expansion/contraction. |
| P2-17 | **Cross-tab logout missing** | Pelle §2.4 F | `use-auth.ts:98-117` | 3 | 0.5d | `BroadcastChannel('acreos-auth')`. |
| P2-18 | **Clerk proxy host hardcoded** | Pelle §2.1 | `routes.ts:248` | 2 | 0.5d | Env-var. |
| P2-19 | **`hydrateUser` 5xx 500s the whole request** | Pelle B | `clerkAuth.ts:68` | 2 | 0.5d | Insert minimal row from JWT claims. |
| P2-20 | **No DLQ; supervisor counts in process memory** | Iván §3, Beata, Olu §3 | `jobSupervisor.ts` | 3 | 2d | Persistent failure counter. Outbox table. |
| P2-21 | **Mobile picker apologizing for desktop IA** | Karri §1-§4 | `pages/settings.tsx` | 2 | covered | (P1-26) |
| P2-22 | **Founder bypass `req.isFounder` not honored** | Liana §3, Sam §1 R1 · B: Coriander §1.5 (`readOnly: true` impersonation flag is a comment) | `server/utils/permissions.ts:233`, `clerkAuth.ts:103,153` | 3 | 2d | Either `requirePermission` honors + audit-logs OR build act-as-tenant. |
| P2-23 | **6 of 6 declared roles silently degrade to `member` + Wave B Reyna VA-role** | Liana §2, Vincent · B: Reyna §1, Imelda-VA §1, Blanco §1 | `permissions.ts:154`, `routes-organization.ts:1126` | 3 | 2d | Implement real role distinction OR collapse to four pragmatic + add `va` role + add `co_owner`/joint-billing per Blanco §1. |
| P2-24 | **`viewOnlyAssignedLeads` enforced nowhere** | Liana §3 · B: Reyna §1 | `routes-leads.ts:73` | 3 | 1d | Honor flag. |
| P2-25 | **`teamMembers.permissions` jsonb has zero readers** | Liana §2 | `shared/schema.ts:125` | 1 | 0.5d | Give teeth or drop. |
| P2-26 | **No stable cohort retention infra** | Konstantin §2 · B: Indigo §2 | (missing) | 3 | 3d | `retention_events`, `cohort_assignments`, `churn_reasons`. |
| P2-27 | **No `acquisition_source` / `acquisition_cost_cents`** | Marisol §3, Konstantin §2, Camila · B: Ezra §2 (paid-acq plumbing missing in 7 places) | `shared/schema.ts` | 2 | 1d | UTM/source on signup. |
| P2-28 | **Brittle Drizzle schemas drag server types into client; testid hygiene** | Calla §2, Joaquín §6 | data-testids | 2 | 1d | Lint rule. |
| P2-29 | **No first-party AI provider error-callback wiring** | Hessam §2.5, Ines | (missing) | 2 | 1d | webhookDispatcher for OpenAI/Anthropic. |
| P2-30 | **`provider_cache` no TTL cleanup** | Adriana §7, Kenji §6 · B: Wenzeslaus §1 (no orchestrator, no watermarks, no DLQ) | `provider_cache` | 2 | 0.5d | Daily cleanup. |
| P2-31 | **Geocoding uncached** | Kenji §3, Aurelio §6 | `routes-micro-features.ts:262-297` | 2 | 0.5d | 7-day cache. |
| P2-32 | **Static asset cache headers wrong** | Kenji §3 · B: Hugo §3, Otis §1 | `server/static.ts:42-43` | 2 | 0.5d | Hashed → immutable; index → no-store. |
| P2-33 | **No Stripe `apiVersion` + no SCA handling** | Vikram §2, Hana §2 | `stripeClient.ts:77` | 3 | 0.5d | (covered P1-22) |
| P2-34 | **AI output observability split** | Theo §1+§6, Naima | many | 2 | covered | (P1-36) |
| P2-35 | **Single-region single-cluster deploy + zero PITR drill** | Bjorn §3-§5, Salma §4-§7, Adriana §6 · B: Boniface §1-§3 | `fly.toml`, dbBackup.ts | 3 | 1w | (Boniface drill in P0-24) |
| P2-36 | **No SLO commitment / status page** | Ines §6, Greta, Reza §5 · B: Boniface §2 | (missing) | 3 | 1d | Status page wired to Prometheus. |

### §3.3 Brand / SEO / press readiness (Wave A — preserved)

| # | Finding | Sources | File:line | Sev | Effort | Recommendation |
|---|---|---|---|---|---|---|
| P2-37 | **`/why` and 2 of 8 public pages no SEO keyword** | Dilan §3 · B: Bertha §3 (ASO name+subtitle dangerous) | many | 2 | 0.5d | "Land Investing CRM Pricing." Per-page JSON-LD. |
| P2-38 | **Press kit at 15%** | Greta §2 · B: Roxanne §1 (conference Diamond/Platinum), Geoffrey §1 (sponsorship trust gates), Lavinia §2 (legitimacy markers) | (missing) | 2 | 1.5w | Greta §3 sprint. |
| P2-39 | **Three Bloomberg-headline-grade press risks** | Phineas-A #1-#5 · B: Cesar §1, Aniyah §2, Cordelia §2 | (architectural) | 3 | covered | covered by P0-3, P0-17, P0-18, P1-31 |

### §3.4 Mobile / a11y / iOS (Wave A) + Beck/Tobias/Mavis/Earl (Wave B)

| # | Finding | Sources | File:line | Sev | Effort | Recommendation |
|---|---|---|---|---|---|---|
| P2-40 | **WCAG 2.2 AA — partial pass with 2 systemic fails** | Devereux §1-§4, Reuben | many | 3 | 1w | Devereux §6 sprint. |
| P2-41 | **Homestead-dark `--acr-brand` 4.1:1 fails AA** | Tessa §3 | index.css | 3 | 1d | Push to 4.8:1. |
| P2-42 | **iOS Safari — 11 `100vh` leaks** | Skye §2, Vesna P1-7 | many | 3 | 1d | (P2-9) |
| P2-43 | **iOS-Safari Apple Pay disabled** | Skye, Vikram · B: Devika §1 (Google Pay also disabled — same way) | `stripeService.ts` | 2 | 0.5d | `automatic_payment_methods: { enabled: true }`. |
| P2-44 | **Field-mobile touch targets 28px** | Aurelio §2 · B: Janetta §1, Devika §1 | `pages/leads.tsx` | 3 | 0.5d | 48px. |
| P2-45 | **3 optimistic-update sites of 677 useMutation (0.4%)** | Bavo §2, Priya §2 | many | 3 | 1w | onMutate for 5 verbs. |
| P2-46 | **`<motion.div key={location}>` precludes `layoutId` cross-route morphs** | Kade §2-§3, Lukas §2 | `App.tsx:928-946` | 3 | 1d | Remove PageWrapper. |
| P2-47 | **No `data-sentry-mask` on owner-name/phone/email DOM nodes** | Naima §3, Anouk · B: Augustin Q18 | many | 3 | 1d | replayIntegration mask. |
| P2-48 | **Two checklists for first-run** | Yuna §1+§9, Camila §3, Sigrid · B: Galen §1 (concierge fills gap manually) | many | 3 | 2d | Kill OnboardingChecklist. Persona-aware. |

### §3.5 NEW — Wave B specialized engineering deep-dives (Batch 8)

| # | Finding | Sources | File:line | Sev | Effort | Recommendation |
|---|---|---|---|---|---|---|
| P2-49 | **Sigvard SBOM — ~1,576 transitive deps; no CycloneDX/SPDX SBOM generation, no signed npm install enforcement, `legacy-peer-deps=true`** | Sigvard §1-§6 | `package.json`, `.npmrc` | 3 | 1w | Generate SBOM in CI. Enforce `--engine-strict`. Signed-install policy. Pin Node 22.x exact (`>=22` is too loose for supply chain). |
| P2-50 | **Sigrún realtime — no Redis pub/sub adapter; broadcasts on machine A invisible on machine B with `min_machines_running=2`** + War Room and Agent Debate Panel are 3-second polling loops; KPI hook opens a second WebSocket to same `/ws` doubling connections. | Sigrún §1, Salma-A §4 | `server/websocket.ts`, `server/index.ts`, `client/src/hooks/useKpiStream.ts` | 4 | 1w | Redis adapter. Consolidate to single `useRealtime()` connection. Convert War Room + Debate to WebSocket subscribers. |
| P2-51 | **Wenzeslaus ETL — functional ad-hoc; no orchestrator, no watermarks, no DLQ, partial idempotency, deletes silently ignored** | Wenzeslaus §1 | `server/jobs/dataIngestJob.ts`, county ingest *(2026-08-01: `dataIngestJob.ts` deleted — module orphan, never scheduled; county ingest remains the live lane)* | 3 | 2w | Watermark column on every source. DLQ + replay. Soft-delete propagation. Cron orchestrator (Temporal-light or pg-cron + observability). |
| P2-52 | **Iolanda Salesforce — zero Salesforce-specific code; ISV listing requires Connected App + managed package + named-credential OAuth + SOQL projection** | Iolanda §1, Penelope-A | missing | 2 | 6w (defer past 100 customers) | Standalone integration project; defer to Q4 2026 unless paying Penelope-tier customer demands. |
| P2-53 | **Whittaker data-provider partner readiness — "I'll bring the term sheet"** but BD-side wants per-org rate-cap, attribution metadata, deduped requests, structured intake | Whittaker §1 | (covered partially by P0-5 + P1-34) | 2 | 2w | Provider-partner-API tier. Volume rebates. Attribution headers on every outbound provider call. |
| P2-54 | **Stanton Lob — four parallel Lob client modules** + no NCOA, no Move Update, no webhook, no return-mail, no template registry, no A/B, no batch endpoint, no campaigns API | Stanton §1, Kira-A A1 | `directMailService.ts`, `directMail.ts`, `mailProvider.ts`, `lobService.ts` | 3 | 2w | Consolidate to one client. Wire NCOA at ingest. USPS Move Update compliance. Webhook listener for tracking. Return-mail flow. |
| P2-55 | **Yara claims-adjuster — canvas re-encode destroys EXIF; no `capturedAt` on `fieldScoutPhotos`** — corroborative-only AcreOS evidence in property-claim disputes; pay-on-satellite-evidence today. | Yara §1 | `fieldScoutPhotos`, photo upload pipeline | 3 | 1w | Pin original photos with EXIF intact. SHA-256 hash. `capturedAt` from EXIF. (Overlaps with P1-19.) |

### §3.6 NEW — Wave B regional / vertical / niche schema gaps (representative — full list in §11)

| # | Finding | Sources | File:line | Sev | Effort |
|---|---|---|---|---|---|
| P2-56 | **`landStatus` enum + LAR overlay** (Aniyah) | (covered P0-18) | | | |
| P2-57 | **Water-rights data model — priority date, seniority, severance, beneficial-use record** — 5 western states (ID/MT/WY/UT/NV) absent from `WATER_RIGHTS` lookup despite UI advertising them | Roger §F1, Manuel §3, Bryce §1, Vivienne §1 | `server/services/environmentalIntelligence.ts:21-100` | 3 | 2w |
| P2-58 | **Mineral rights — severed estate as first-class concept; decimal interest math; division-order tracking** | Saoirse §1-§2, Bryce §1, Tom §1 | (missing) | 2 | defer |
| P2-59 | **Foreign-buyer FIRPTA / W-8BEN / state foreign-ownership / SWIFT/IBAN / currency / i18n** | Heng §1, Camille-FC §2, Mateus §1, Chinedu §2, Dorian §1 | (missing) | 3 | 12w (Nakamura plan) |
| P2-60 | **Joint-owner `co_owners` relation + dual-billing-card + dual-tax-contact** | Blanco §2 | `shared/schema.ts:15-115` | 3 | 1w |
| P2-61 | **Estate / fiduciary access — death-cert intake, executor-portal, autopay holdback, beneficiary entity, K-1 surface** | Martin §1-§3, Penelope §1, Constance §1 | missing | 3 | 2w |
| P2-62 | **Tenant entity (Imelda-A landlord) — separate from leads; lease object; rent ledger; maintenance ticketing** | Imelda-A | (out of scope per Wave A — defer) | — | defer |
| P2-63 | **Acquired-notes data model (Linnea-A)** | (covered §5 vertical roadmap) | | | |
| P2-64 | **`bia_transaction_workflow` template + fractionated heirship undivided-interest tracker (Aniyah §3)** | Aniyah §3 | (missing) | 2 | defer (very niche) |
| P2-65 | **Buyer-side / first-time-buyer trust profile** — `acreos.io/trust/:orgSlug` public verified profile; QR on mailers; LandWatch syndication closes data loop | Brendan §1-§4 | missing | 3 | 2w |

### §3.7 NEW — Wave B partner-readiness items (full list in §14)

| # | Finding | Sources | Sev | Effort |
|---|---|---|---|---|
| P2-66 | **Adelaide NAR — `realtor` trademark in 5 server-side outbound templates** | Adelaide §1 | 3 | 1d |
| P2-67 | **Adelaide NAR — RESO/MLS connector lacks per-MLS policy layer + flow-down agreements + sold-data restrictions + RESO certification** | Adelaide §2 | 3 | 1q |
| P2-68 | **Reginald — `RequiredDisclaimer` lacks `fair_housing` type; governance engine landed but render layer doesn't enforce** | Reginald §1-§2 | 3 | 2d |
| P2-69 | **Beaufort auction — `COUNTY_AUCTION_SOURCES` is 3-row TS constant; `generateMockAuctionData` is `Math.random()`; no inbound results-webhook; no calendar-federation; no `auctionDirection` (FL bid-down)** | Beaufort §3, Rina §2 | 3 | 1q |
| P2-70 | **Brindley affiliate — typo `convertedAt` vs `creditedAt`; `(req.user as any)` violates CLAUDE.md; reward hardcoded $1; no commission rate / no cookie / no UTM / no payout** | Brindley §2 | 2 | 1w (bugs) + 8w (program) |
| P2-71 | **Talia bank — referral system is a viral loop, not a partner platform; needs parallel `partners` surface** | Talia §1 | 2 | defer |

---

## §4. P3 — Future-State (schedule for after 100 customers)

**Now 22 items.** Wave A had 12; Wave B adds 10 explicit-defer institutional / niche / international fits.

| # | Item | Why defer | Source |
|---|---|---|---|
| P3-1 | Multi-region (EU/CA) | Salma tripwires | Salma §1 |
| P3-2 | SOC 2 Type 1 | 90-day blocker chain | Sam §6 |
| P3-3 | Family-office multi-entity | Theodora explicit no. **Burt confirms**: leave off roadmap. | Theodora, Burt §1 |
| P3-4 | Capital-markets full PPM/waterfall/Form D | Otto + Camille-inst + Tristan + Preston + Rashad: position upstream as data feed, not as fake securitization engine | Otto, Camille-inst, Tristan, Preston, Rashad |
| P3-5 | Subdivision lot-draw | Brigid + Pearl: ship after Note Investor | Brigid, Pearl |
| P3-6 | Tenant + lease + maintenance-ticketing | Imelda: 20% built; almost a separate product | Imelda-A |
| P3-7 | Native attorney-grade contracts | Whitman: integrate doc-prep service instead | Whitman, Hartwell |
| P3-8 | 1098-INT + 1099-NEC + W-9 + K-1 batch (deeper) | Required before Note vertical | Zerah, Wendell, Olympia, Hilda, Martin |
| P3-9 | Real-time voice AI ($0.30/call) | Wild card | Sandeep, Mateo, Tariq |
| P3-10 | iOS native app (Capacitor wrap) | Web mobile first; **Andrei specifies which 2 plugins are load-bearing (background-location, iOS push)** | Sven, Skye, Andrei |
| P3-11 | Audio sound-vocabulary | "AcreOS hasn't earned right yet" | Sven |
| P3-12 | Hreflang / i18n SEO | Fine today | Dilan |
| P3-13 | **NEW — TIMO institutional product** | Burt: leave off roadmap. Cruise data, MBF inventory, harvest plan, carbon-registry, LP capital-account ledger. | Burt §1 |
| P3-14 | **NEW — Ag-REIT institutional farmland** | Frederick: don't build farm-manager-tenant-operator triangle until you have a Frederick-tier pilot signed | Frederick §1 |
| P3-15 | **NEW — RV-park / mixed-use developer SKU** | Lila: front-of-funnel only; integrate Procore/Buildertrend on back end if at all | Lila §1 |
| P3-16 | **NEW — Ground-lease / cell-tower / pad-site / commercial-land** | Quentin: residential `leases` schema is wrong shape; defer | Quentin §1 |
| P3-17 | **NEW — Self-storage / commercial-land thesis-flipper** | Sebastian: `commercial_land_specialist` archetype invisible; defer | Sebastian §1 |
| P3-18 | **NEW — Mineral rights vertical** | Saoirse: 12-month build with domain expert | Saoirse §1 |
| P3-19 | **NEW — Pre-development (730-day cycle)** | Otto: `developer` enum exists, due-diligence engine has 3 BusinessDDType values none of which are mine | Otto §1 |
| P3-20 | **NEW — 1031 QI back-office partner integration** | Kassidy: `listExchanges` returns `[]`; defer integration past in-house deadline calendar fix | Kassidy §1 |
| P3-21 | **NEW — LP-fund full stack (capital accounts, NAV, waterfall, K-1, audit packet)** | Tristan + Preston + Rashad converge: zero plumbing today; "vocabulary without plumbing" | Tristan, Preston, Rashad |
| P3-22 | **NEW — Salesforce ISV listing** | Iolanda: 6w project + AppExchange; defer until Penelope-tier customer demands | Iolanda §1 |

---

## §5. Brand voice + narrative gaps (P1)

Already covered in §2.1. Wave B adds:

| Site | Issue | Fix | Source |
|---|---|---|---|
| `routes-deals.ts:654` AI prompt | Customer-visible-via-tool-output: "platform for LAND investors..." | Sanitize prompt-leak via tool-output | Lila §2 |
| `cancellation-dialog.tsx` "Downgrade instead" | Calls `handleClose` — extinguishes downgrade intent | Wire to plan picker pre-selected to lower tier | Vesper §3 |
| `OnboardingWizard.tsx:120` "You're All Set!" | They are not all set — start of onboarding | "Schedule your concierge call" or "Connect your data and meet Pax" | Galen §1 |
| `coverage-page.tsx:236` maintenance | "Sophie/Atlas" | (covered) | Hiroko |
| Pax response | Wall-of-280-words | Headline + 3 bullets + "Read aloud" | Beck §2 |
| Translation registers (FR-CA, ES, PT, VN) | English only | Nakamura 12-week plan; defer to second locale-paying customer | Camille-FC, Esperanza, Mateus, Linh, Heng, Nakamura |

---

## §6. Compliance + Legal exposure (P0/P1)

| # | Risk | Severity | Cost-of-incident | Mitigation | Source |
|---|---|---|---|---|---|
| C1 | **ESIGN/UETA: 1.5 of 5 elements** | 5 | $50K-$300K per contested signing | P0-3, P0-7, P1-30, P1-31 | Marguerite |
| C2 | **TCPA / 10DLC; skip-trace PoU** | 5 | Class-action damages | Skip-trace PoU attestation, suppression-list, opt-out | Kira, Phineas-A, Marcus, Mireille, Caspian |
| C3 | **GDPR/CCPA/CPRA — DSAR scoped wrong; zero DPAs counter-signed; GPC ignored** | 4 | Cal. AG private-right-of-action | P1-23, P1-24, P1-25 | Anouk, Phineas-A, Harlowe |
| C4 | **Sales tax (Wayfair) — 18+ states** | 4 | $50K-$150K back-tax | P1-21 + Jorge TX franchise tax | Hana, Vikram, Marisol, Jorge |
| C5 | **AI-generated legal docs from `gpt-4-turbo-preview` with zero post-validator** | 5 | Per-state malpractice | P1-38 | Theo, Sayuri, Marguerite, Cordelia |
| C6 | **Wholesaling-license traps in IL/OK/SC + NM Subdivision Act + WA buyer-broker requirements** | 3 | Per-deal license action | P1-31; **Wave B adds**: NM (Vivienne §1), NC mountain Ridge-Act + coastal CAMA (June §1-§2) | Trey, Whitman, Vivienne, June |
| C7 | **Audit log not tamper-evident** | 3 | SOC2 finding **+ Lazlo discovery exploit** | (P2-12) | Sam, Adriana, Lazlo |
| C8 | **Fair-housing / FCRA on tenant CRM** | 3 | Class-action exposure | Defer Imelda landlord vertical (P3-6) | Imelda |
| C9 | **PII to OpenAI/Anthropic without ZDR** | 4 | FTC §5 textbook | ZDR config + DPA | Anouk, Harlowe, Augustin |
| C10 | **`twoFactorEnabled` non-functional** | 4 | SOC2 CC6.1 + Augustin UW Subjectivity #1 | (P0-4) | Sam, Pelle, Augustin |
| C11 | **NEW — TX §5.069 / §5.072 absent on contracts-for-deed** | 5 | Per-deal void — instrument unenforceable | P0-17 | Cesar |
| C12 | **NEW — Indian Country / trust-restricted-fee parcels processed without `landStatus` awareness** | 5 | "Confidently incorrect output on highest-risk transactions" — federal trust violation | P0-18 | Aniyah |
| C13 | **NEW — `realtor` trademark in 5 server-side outbound templates** | 4 | NAR trademark; platform is publisher | P2-66 (1d fix) | Adelaide |
| C14 | **NEW — RESO/MLS-licensee posture missing** — moment a customer connects MLS, AcreOS becomes consumer bound by IDX/VOW + flow-down terms | 4 | Per-MLS license breach | P2-67 | Adelaide, Reginald |
| C15 | **NEW — Hardcoded `payerEin: "00-0000000"` on every 1099 generated to date** | 4 | IRS information-return failure (Section 6721 penalty $290/return × 3 yrs × every customer) | P0-16 | Phineas-IRS, Olympia, Hilda, Martin |
| C16 | **NEW — Litigation-hold absent + nightly retention purge = spoliation by neglect** | 4 | Adverse-inference instructions; spoliation | P0-23 | Saskia, Lazlo, Margolis, Cordelia |
| C17 | **NEW — Estate / fiduciary access — no death-cert intake, no executor flow, no autopay holdback during gap; 47 borrowers about to autopay an account that legally cannot accept funds** | 4 | Class-action exposure if mishandled | P2-61 | Martin |
| C18 | **NEW — Foreign-investor FIRPTA / W-8BEN / state foreign-ownership / SWIFT/IBAN / source-of-funds documentation** | 3 | IRS withholding penalties + state restriction violations | P2-59 | Heng, Chinedu, Camille-FC, Mateus, Dorian |

---

## §7. Accessibility Findings (P1)

| # | Finding | Severity | Effort | Source |
|---|---|---|---|---|
| A1 | **SC 1.1.1 systemic fail — ~55 raw `<button>` icon-only sites missing `aria-label`** | 3 | 1.5d | Devereux, Reuben |
| A2 | **SC 1.4.3 systemic fail — `--acr-ink-3` 3.31:1; chart palette fails 3:1** | 3 | 1d | Devereux, Tessa |
| A3 | **SC 2.4.2 — `useDocumentTitle` not wired per route** | 2 | 1d | Devereux, Reuben |
| A4 | **SC 2.5.8 partial — desktop icon buttons `h-7 w-7`** | 2 | 1d | Devereux |
| A5 | **Charts read as "image"** | 3 | 1.5d | Devereux, Reuben |
| A6 | **Pipeline kanban tells screen readers nothing** | 2 | 1d | Reuben |
| A7 | **Skip-link OK; focus-not-obscured unclear** | 1 | 0.5d | Devereux |
| A8 | **Reduced-motion respected at three layers** — already excellent; protect | — | — | Devereux (positive) |
| A9 | **NEW — No TTS / no "Read aloud" button on legal docs or Pax responses; `native` font pairing exists but no Lexend/OpenDyslexic option; no "reading" density mode** | 3 | 4d (TTS) + 1d (Lexend) + 0.5d (density) | Beck §2-§4 |
| A10 | **NEW — Cognitive-accessibility absent — no "more time, less density" toggle for working-memory deficits; wizards advance on accidental clicks** | 3 | 1w | Tobias §1 |
| A11 | **NEW — Older-user accommodations — swipe-to-decide card locked Mavis out; needs visible button affordance + larger default tap targets + simpler language** | 3 | 1w | Mavis §1 |
| A12 | **NEW — Low-literacy / picture-first mode** — Earl §1: maps work, parcels visible, but text density is the wall. Picture-first parcel cards + voice + simpler button labels | 3 | 1w | Earl §1 |
| A13 | **NEW — ADHD-friendly defaults — focus mode, enforced quiet hours on in-app, wizard save-state everywhere** | 3 | 1w | Yelena §1 |

---

## §8. Findings inventory by domain (top finding per domain) — Wave A preserved + Wave B additions

[Wave A's 60-row table preserved; representative additions below — full integration in §11/§12/§13/§14/§15.]

| Domain | Top Finding | Source |
|---|---|---|
| **NEW — Indian Country / tribal land** | `landStatus` enum + LAR overlay + BIA workflow template — platform produces confidently-incorrect output on highest-risk transactions | Aniyah |
| **NEW — TX contracts-for-deed** | §5.069 / §5.072 disclosure absent → instrument void | Cesar |
| **NEW — Foreign buyer / cross-border** | English-only assumption; FIRPTA / W-8BEN / SWIFT / currency / i18n absent | Heng, Camille-FC, Mateus, Linh, Chinedu |
| **NEW — Joint-owners / dual-card / shared-tax-id** | `co_owners` relation + dual billing + LLC EIN on Stripe customer | Blanco |
| **NEW — Account takeover / lockout / estate** | Asher 6h/9-actions/0-friction; Cleo 9-day lockout; Martin 47 borrowers' autopay | Asher-takeover, Cleo, Martin, Coriander |
| **NEW — Litigation hold / discovery** | Five-alarm gap: spoliation by neglect via nightly retention | Saskia, Lazlo, Margolis |
| **NEW — Monthly close / CPA year-end / 1099 batch** | Trial balance doesn't exist; chart-of-accounts absent; `00-0000000` EIN | Lavender, Hilda, Olympia, Phineas-IRS |
| **NEW — Migration in / migration out** | 500-row import cap; four parallel export systems | Magdalena, Tobiah |
| **NEW — Reactivation / win-back** | `eventType: 'reactivate'` schema-only; cancellation-survey unread; 6-segment matrix absent | Renoir, Indigo, Vesper |
| **NEW — Recovery console** | `psql` window + Slack channel for sessions/2FA/autopay/transfer | Coriander |
| **NEW — DR drill / RTO/RPO commitment** | Never-restored 12-40 min RTO claim is a lie | Boniface |
| **NEW — Deliverability foundation** | 3/10; single SES identity; no DKIM/bounce/List-Unsubscribe/warmup | Eleonora |
| **NEW — DNS / cert automation for white-label** | Half-built bridge; first reseller gets Fly TLS error | Cuthbert |
| **NEW — Vector retrieval** | 0.5/5; jsonb embeddings + TS-side similarity | Sayuri-Vatanen |
| **NEW — Voice AI / TTS** | C+; no TTS, no voice-Pax in field-mobile | Tariq |
| **NEW — Realtime / WS** | No Redis pub/sub adapter; broadcasts invisible cross-machine | Sigrún |
| **NEW — i18n infrastructure** | Zero infrastructure; 12-week build per Nakamura | Nakamura, Camille-FC, Mateus, Linh, Heng |
| **NEW — Insurance / E&O / cyber UW** | Conditional declines; subjectivities map to existing P0/P1 | Cordelia, Augustin |
| **NEW — Title-company partner API** | Fax-and-PDF customer; 6w to API partner | Hartwell, Esther, Zephyr |
| **NEW — Auction-platform partner API** | Mock data + no inbound results webhook + no calendar federation | Beaufort, Rina |
| **NEW — Affiliate program** | Typo + `(req.user as any)` + $1 reward + no cookie/UTM/payout | Brindley, Lavinia |
| **NEW — Conference / podcast sponsorship readiness** | Conditional Platinum / no keynote yet | Roxanne, Geoffrey |
| **NEW — Coaching / cohort provisioning** | No sandbox mode; no batch-provisioning; no instructor view | Nadege |
| **NEW — Co-marketing / reseller / agency / Salesforce ISV** | Plumbing partial; legitimacy markers weak; 70/30 split wrong direction | Lavinia, Garrison, Toren, Iolanda |

---

## §9. Cross-cutting themes

### Theme 1 — "The bones are good; adoption is the gap." (preserved + extended by Wave B)
**Wave B confirms across 30+ more personas.** The pattern repeats: `governance_policies` engine right but render layer doesn't enforce (Reginald); `simulated_actions` primitive right but `legalHold` not composed from it (Margolis); `fullTextSearch.ts` + GIN indexes right but no route calls it (Anaïs); Capacitor blueprint right but `ios/` + `android/` directories absent (Andrei); mobile foundation excellent but adopted on 7% of surfaces (Janetta); Lob integration healthy at basics but four parallel client modules (Stanton); white-label plumbing right but ACME automation absent (Cuthbert); chart-of-accounts schema partially shaped but no double-entry framing (Hilda); `costBasisTracker` exists but no DoD step-up (Penelope); audit-log shape IRS-grade when it fires but doesn't fire on 8 of the 12 events that matter most (Phineas-IRS).

### Theme 2 — "The voice carries; the brand doesn't." (preserved)
Wave B adds: Pax response shape regression (wall-of-text), TTS absence as a brand-completeness gap (Beck), AI prompts visible to customer via tool output (Lila), accessibility-lens voice failures (Tobias, Mavis, Earl).

### Theme 3 — "The accounting/legal/compliance layer is at pre-seed maturity." (preserved + sharpened)
**Wave B sharpens to "the accounting/legal/compliance layer is at pre-pre-seed maturity for any customer past the wedge profile."** Add: hardcoded EIN trashes every 1099, no chart-of-accounts, no trial balance, no double-entry, no QBO journal export, single platform SES identity, no litigation-hold mechanism, no estate-executor flow, no death-certificate intake, no monthly-close infrastructure, no RTO/RPO commitments, four parallel export systems, two parallel white-label schemas, Lazlo can extract spoliation arguments from the retention cron.

### Theme 4 — "The agent layer is automation without a fallback." (preserved + extended)
**Wave B extends to "automation without a recovery surface."** Same agent-layer-strength on common path; same gap on uncommon path; *plus* every uncommon-path event now has a specific Wave B persona who maps the gap (Asher-Mendoza takeover, Cleo lockout, Martin estate, Vesper cancellation, Renoir reactivation, Magdalena migration-in, Tobiah migration-out, Coriander recovery console, Boniface DR drill, Cordelia E&O scenarios). The recovery-console-as-DB-write pattern is the single biggest founder-time burn at scale beyond the agent-layer L2 escalation gap Olu flagged.

### Theme 5 — "Persona-archetype mismatch is the hidden tax." (preserved + tripled)
**Wave A flagged 8 persona-mismatches; Wave B identifies 30+ regional/niche archetypes + 8 institutional non-fits + 8 adversarial/accessibility/bandwidth-constrained personas + 16 ecosystem partner archetypes.** The shape of the right-fit Land Investor is still ~70% of the canonical flipper, but the long tail is wider than Wave A measured: TX disclosure law, NM acequia / Pueblo, NC dual-market, GA timber, IA farmland, Western water, Florida tax-deed bid-down, joint-owners, estates, divorces, foreign buyers, dyslexic / post-stroke / ADHD / older / low-literacy users, slow-connection field-mobile users, VAs in Manila working at 11pm in Tagalog headcanon, 14-year operators on REI Pro, recovering-from-incarceration with KYC false-positives, reservation-adjacent operators handling tribal-trust parcels, non-US-resident / non-USD / non-W-9 buyers — *all of these exist in the AcreOS market today and the platform serves none of them well*. **The strategic insight is that the wedge target — the canonical Land flipper — may be 50% of the actual market, not 95%.**

### Theme 6 — NEW — "Lifecycle ops is a separate product surface AcreOS hasn't built." (Wave B)
**Personas flagged:** Asher-takeover, Cleo, Martin, Coriander, Boniface, Magdalena, Tobiah, Renoir, Indigo, Vesper, Lavender, Hilda, Olympia, Bartholomew, Phineas-IRS, Jorge, Yara, Sigfried, Galen, Magnolia, Cassiopeia, Persephone, Tristan, Rashad, Preston, Constance, Henrik, Kassidy, Eulalia, Esther, Hartwell, Zephyr, Augustin, Cordelia (34 personas).
**Root cause:** AcreOS treats the customer journey as: signup → trial → upgrade → daily-use forever. Wave B surfaces 8 lifecycle phases AcreOS hasn't built: (a) onboarding hand-walk + concierge handoff, (b) account-recovery / takeover-response / lockout / estate, (c) annual / quarterly review + portfolio reporting, (d) monthly close / year-end / IRS audit / state audit, (e) cancellation / reactivation / win-back, (f) migration in / migration out / data portability, (g) deprecation / sunset / migration-from-legacy-endpoints, (h) DR / ransomware / RTO/RPO. Each is a real product surface — most exist in mature SaaS — and AcreOS has primitives for them but no composed product.
**Systemic fix:** Treat lifecycle ops as a Q3 2026 product line. Sequence: recovery console (P0-22) + estate flow (P2-61) + monthly close (P1-48) + 1099 batch (P0-16) + migration in/out (P0-21) + reactivation (P1-49) — these are the six Wave B-specified items that close the most-cited gaps.

### Theme 7 — NEW — "The partner-API surface is a future revenue line; today it's a fax-and-PDF customer." (Wave B)
**Personas flagged:** Hartwell, Stanton, Adelaide, Reginald, Beaufort, Whittaker, Talia, Iolanda, Brindley, Lavinia, Garrison, Toren, Geoffrey, Roxanne, Eulalia, Caspian (16 personas).
**Root cause:** Every partner Wave B brought in (title, mail, MLS, NAR, auction, data-provider, bank, Salesforce, affiliate, co-marketing, reseller, agency, podcast, conference, RON, skip-trace) said the same thing: "AcreOS today is a high-quality manual-handoff partner; six engineering deliverables move it to API partner; the bones are right; the partner-API tier does not exist." The framework — `webhookDispatcher`, HMAC signing, OpenAPI spec — is real. The partner-event registry and the inbound-webhook-from-known-partner pattern is missing.
**Systemic fix:** Stanton's six P1 deliverables are the spec for every partner. Build the partner-API tier as a first-class product surface in Q4 2026; pick title (Hartwell, $850-1,400/file in revenue at 28-32 closings/month) as the pilot. Brindley + Lavinia + Garrison + Talia + Roxanne + Geoffrey are downstream marketing motions waiting on the same API tier.

---

## §10. Findings *NOT* taken forward (explicit "do not do" with Wave B confirmations)

(Cross-references the §7 of `_ACTION-PLAN.md`.) Wave B added 8 institutional / vertical / accommodation non-fits to this list:

- Burt TIMO institutional product
- Frederick ag-REIT institutional farmland product
- Camille-institutional aggregator-fund-tooling
- Tristan / Preston / Rashad LP-fund full stack
- Kassidy 1031-QI back-office partner
- Lila RV-park / mixed-use developer SKU
- Saoirse minerals vertical
- Quentin / Sebastian commercial-land + ground-lease
- Otto pre-development 730-day cycle
- Iolanda Salesforce ISV listing (defer past 100 customers)
- Nakamura full i18n infrastructure (defer until paying second-locale customer demands)
- Ramona divorce-aware product (compose `legalHold` org state instead — Margolis primitive)

---

## §11. NEW — Persona-vertical-fit matrix (Wave B Batches 4 + 8 user archetypes)

**30 regional/niche archetypes + 8 user archetypes = 38 personas mapped against the canonical Land flipper wedge.** Each row tags fit + missing-primitive + recommendation.

| Archetype | Fit | Missing Primitive | Recommendation |
|---|---|---|---|
| Cesar (TX contracts-for-deed) | Today: dangerous (P0-17) | §5.069 / §5.072 disclosure embed | P0 fix |
| Hank (AZ flipper) | A- | County-rule depth (Maricopa vs rural) | Defer; cover via state-config |
| Bryce (CO mountain) | C+ | POA, water severance, mineral severance, NM-style disclosure | Defer Pro; offer Starter |
| Marisol-CA (CA-spec) | B-: Prop 19, witness gap | Witness count, AB/SB-303, Prop 19 inheritance | 2w |
| Vivienne (NM acequia/Pueblo) | C: Spanish land grants invisible | Acequia parciante share, Pueblo overlay, NM Subdivision Act | Defer Pro; recommend Starter only |
| June (NC two-market) | C+: CAMA / Ridge-Act invisible | CAMA + Ridge-Act + 2-witness | 2w |
| Tom (PA Marcellus) | D+: Marcellus oil/gas not modeled | Mineral-rights-pulled-out subscript | $20 county-lookup only |
| Wyatt (TN Cumberland) | C: Greenbelt, 2022 wholesale tightening absent | TN-specific intel | 1w |
| Della (GA timber) | C: timber valuation primitive absent | Stumpage, MBF, stand age, hunting lease | Defer Pro; data model in Q4 |
| Frederick (IA farmland REIT) | F: institutional buy-and-hold | Farm-manager-tenant-operator triangle | P3 defer |
| Manuel (CA permanent crops) | D: built for raw-land flippers | Tree-asset, water rights, irrigation district | Defer Pro |
| Tabitha (lakefront) | C: well-setback overlay missing | Grandfathered-nonconforming flag; 50ft setback | 1w |
| Vesta (hunting) | D+: SelectItem dropdown only | Game data, lease ledger, trail-cam | Defer |
| Saoirse (minerals) | F | Decimal-interest math, division-orders, NPRI/RI/WI | P3 defer (12-month build) |
| Roger (water rights) | F: 5 of 10 advertised states unsupported | Priority-date, severance, beneficial-use, forfeiture | 2w (just data-fill 5 missing states) |
| Quentin (cell tower) | F: residential lease schema | Ground-lease data model | P3 defer |
| Sebastian (self-storage) | F: `commercial_land_specialist` archetype invisible | New archetype | P3 defer |
| Lila (RV park) | C: front-of-funnel only | Entitlement/permit/vertical/stabilize lanes | P3 defer; market as front-of-funnel only |
| Otto (pre-development) | F: 730-day cycle vs 90-day | Long-cycle deal-room + entitlement-tracker | P3 defer |
| Ezekiel (urban-infill) | F: 50-lots-out-of-one-docket pattern | Docket-acquisition primitive | Defer |
| Pearl (quick-subdivider) | C+: lighter than Brigid | Eight-lot road-frontage subdivision | Defer; ride on Note vertical |
| Wynn (owner-occupier) | D-: pricing structure wrong | Owner-occupier "pause-when-not-hunting" SKU | Either Free-only honestly OR new SKU |
| Brendan (first-time buyer) | F: buyer-side invisible | Public verified-by-acreos.io trust profile + QR | 2w |
| Heng (foreign buyer) | F: silently US-only | FIRPTA/W-8BEN/state foreign-ownership/SWIFT/currency/i18n | P3 defer infrastructure |
| Reyna (Manila VA) | C: timezone, glossary, VA role | TZ on user, glossary tooltips, `va` role, plain-English errors, org-switcher | 1w |
| Imelda-VA (six-VA shop) | D: team-of-3 product not shipped | Vincent §1 fixes | Q3 |
| Blanco (joint-owners) | D: single-owner assumption | `co_owners`, dual-billing, dual-tax | 1w |
| Aniyah (tribal-restricted-fee) | F: dangerous (P0-18) | `landStatus` enum + LAR + BIA workflow | P0 fix + 2w schema |
| Camille-FC (Quebec) | F: silently US/EN | i18n + FIRPTA + CAD + civil-law disclosure | P3 defer infrastructure |
| Mateus (Portuguese/MA) | F: silently US/EN | i18n + CPF/CNPJ + BRL recognition + FIRPTA | P3 defer |
| Linh (Vietnamese/TX) | F: zero non-EN affordances | i18n + Zalo/Viber/Messenger + intergenerational signing | P3 defer |
| Esperanza (Spanish/TX border) | F: zero bilingual | (Nakamura plan) | P3 defer infrastructure |
| Chinedu (immigrant ITIN) | F: ITIN as data-entry edge case | `tinType` enum, `dateOfBirth`, `country`, `nationality` | 1w (schema) |
| Dorian (released, KYC false-pos) | F: KYC silently shadow-bans | Provider-transparency + manual-review SLA + doc-based ID path | 1w |
| **Beck (dyslexic)** | C: TTS absent | Read-aloud + Lexend pairing + reading density | 1w |
| **Tobias (post-stroke)** | C-: cognitive-a11y absent | "more time, less density" mode | 1w |
| **Mavis (older user)** | C: swipe locked her out | Visible button affordances + larger taps + simpler language | 1w |
| **Earl (low-literacy)** | C: text density wall | Picture-first parcel cards + voice | 1w |
| **Yelena (ADHD)** | C+: bones present | Focus mode + enforced quiet hours in-app + wizard save-state | 1w |

---

## §12. NEW — Lifecycle / end-of-cycle ops gaps (Wave B Batch 7)

**25 lifecycle audits surface a coherent missing product line.** Sequence the build:

| Phase | Persona(s) | Key gap | Effort |
|---|---|---|---|
| Onboarding hand-walk | Galen | Concierge handoff at day 90; column mapping (40-60 min/session today); de-dupe primitive | 1w |
| Annual / quarterly review | Persephone, Tristan | Composer for portfolio review artifact; LP-statement engine | 2w (Persephone) + P3 (Tristan) |
| Monthly close | Lavender | Chart-of-accounts + double-entry + trial balance + GL-PDF + IIF/QBO journal | 2w |
| CPA year-end | Hilda | Same as Lavender + 1099 batch | covered |
| 1099 batch | Olympia | Form 1099-INT (not 1098) + 1096 transmittal + IRS FIRE e-file | 2w |
| IRS audit | Bartholomew, Phineas-IRS | "Audit packet" export endpoint + immutable audit-log + chain-of-custody | 1w |
| State audit | Jorge | TX franchise tax + sales-tax-on-SaaS surface | 2w |
| Insurance claim | Yara | EXIF preservation + capturedAt + photo hash | 1w (covered P1-19) |
| Cancellation | Vesper | Wire "Downgrade instead" + use cancellation-context as retention pitch + pause-90d-at-$0 option | 0.5d |
| Reactivation | Renoir | `/reactivation-context` + `eventType: 'reactivate'` written + "what's new since you left" | 1w |
| Win-back | Indigo | 6-segment 2D matrix + ethical-limit guardrails + ship-update flow | 1w |
| Migration in | Magdalena | 50K row import + tags + comms + documents + assignedTo + createdAt | 1w |
| Migration out | Tobiah | Single-button "everything in one archive" + four-system consolidation | 1w |
| Account takeover | Asher-takeover, Coriander | Recovery console + suspicious-login + email-on-new-location + email-change confirmation step | 2w (P0-22 covers) |
| Lockout | Cleo | Identity-proof workflow + non-logged-in support intake | 1w |
| Estate / fiduciary | Martin | Death-cert intake + executor-portal + autopay holdback + beneficiary entity | 2w |
| Bankruptcy | Constance, Henrik | Post-petition payments panel + §704 trustee-mode + automatic-stay flagging | 1w |
| Divorce | Ramona | `legalHold` (compose from `simulated_actions`) + co-owner-data-isolation | 1w (P0-23 covers) |
| Litigation | Saskia, Lazlo, Margolis, Cordelia, Augustin | (covered P0-23 + P0-3 + P1-23) | covered |
| 1031 exchange | Kassidy | Persistence layer real (currently `return null`) + Exchange Agreement + Assignment + bonded-funds ledger + Form 8824 | 2w (in-house) + P3 (QI partner integration) |
| Probate | Penelope | DoD step-up basis + frozen "as-of DoD" snapshot + beneficiary entity + multi-state ancillary | 2w |
| Disaster recovery | Boniface | First restore drill + ransomware playbook + immutable backup | 1w |
| Feature deprecation | Sigfried | Sunset dates + migration deadlines + Atlassian-Stride playbook | 4d |
| Annual subscriptions | Magnolia | priceYearly + billingInterval + anniversary date + upgrade prompts at 4/9/11mo | 4d |
| Expansion (upsell) | Cassiopeia | In-product expansion offer surface (currently zero) | 1w |

---

## §13. NEW — Adversarial / edge-user accommodations (Wave B Batch 5)

**8 personas surfacing accommodations that are currently absent.** The pattern matches Theme 5 — long-tail users larger than Wave A measured:

| Persona | Accommodation | Cost | ROI |
|---|---|---|---|
| Beck dyslexic | TTS + Lexend + reading density mode | 1w | High — also helps Tobias, Mavis, Earl, Reyna |
| Tobias post-stroke | "More time, less density" mode + wizards advance only on intentional click | 1w | Med — narrow audience but loyalty multiplier |
| Mavis older user | Visible button affordances + larger taps + simpler language | 1w | High — older users skew Land Investor demo |
| Earl low-literacy | Picture-first parcel cards + voice + simpler labels | 1w | Med — small wedge but specific |
| Yelena ADHD | Focus mode + enforced quiet hours in-app + wizard save-state | 1w | High — ~15% of operators per Yelena estimate |
| Otis old laptop | Bundle size reduction (already P2-4); reduced-motion already excellent | covered | Med |
| Hugo rural slow connection | Etag + cursor pagination + 304 on lists + smaller payloads | 1w | High — field operators in low-bandwidth |
| Janetta mobile-only | Foundation excellent; adoption gap on 93% of surfaces (covered Theme 1) | 4w | High — mobile-only is a real subset |
| Devika Android | C+: icon misconfiguration + missing Web Share API + frame drops on Galaxy A14 | 3d | Med — Android skews lower-income field operators |

---

## §14. NEW — Ecosystem partner readiness (Wave B Batch 6)

**16 ecosystem-partner audits all converge on the same diagnosis:** AcreOS has a healthy generic webhook framework + HMAC signing + OpenAPI spec. **What it doesn't have is a partner-tier API**. Six engineering deliverables (per Stanton) move every partner from "fax-and-PDF" to "API partner":

1. Partner registry (Cuthbert white-label + Whittaker data + Hartwell title + Stanton mail + Adelaide NAR + Reginald MLS + Beaufort auction).
2. Per-partner shared-secret + inbound-webhook receiver.
3. Outbound webhook event taxonomy per partner type (`title.commitment_ready`, `auction.bid.won`, `mls.listing_status_changed`).
4. Volume-pricing tier allowing partners to amortize integration cost.
5. Flow-down agreement template for licensed-data partners (RESO, NCOA, MLS).
6. Partner certification status tracked in DB (RESO certification = $15-30K, 1q).

**Sequence:** Title (Hartwell) first — $850-1,400/file × 28-32/month is real revenue and the engineering is bounded. Mail (Stanton) second — already healthy at basics, just needs depth. Then NAR/MLS (Adelaide + Reginald) — but only after RESO certification + flow-down agreements + sold-data restriction enforcement land.

| Partner | Fit today | Effort to partner-tier | Revenue at scale |
|---|---|---|---|
| Hartwell title | Good intake; no API | 6w | $895 avg per file at scale + 40% margin expansion shared as volume rebates |
| Stanton Lob | Good basics; no NCOA/A/B/batch | 2w | Enterprise discount + reduced fraud risk |
| Adelaide NAR | Trademark mistakes + RESO connector posture | 1d (trademark) + 1q (RESO) | NAR member-benefits inclusion |
| Reginald MLS | governance engine + render-layer enforcement | 60d | Per-listing $0.018/mo licensing |
| Beaufort auction | Mock data + no inbound webhook | 1q | Federation deal possible |
| Whittaker data | "I'll bring the term sheet" today | (covered P0-5 + P1-34) | Term sheet in flight |
| Talia bank | Referral system != partner platform | parallel `partners` surface, defer | Pilot deal at scale |
| Iolanda Salesforce | Zero SF code | 6w (defer past 100 customers) | AppExchange listing |
| Caspian skip-trace | Termination warning | (P0-5 covers) | Continued partnership |
| Cordelia / Augustin insurance | Conditional declines | covered | Insurance program for operators |
| Brindley affiliate | $1 reward + bugs | 1w (bugs) + 8w (program) | 30% recurring on referred MRR |
| Lavinia co-marketing | Strong tone, weak markers | 2w | List swap + content piece |
| Garrison reseller | 70/30 wrong direction | 1w (rev-share rebalance) | Reseller channel |
| Toren agency | Plumbing partial | 4w | Agency owner aggregate view |
| Geoffrey podcast | Trust gates conditional | (covered by founder-letter discoverability + /security page) | $4,500/episode × 4 ep test |
| Roxanne conference | Conditional Platinum no keynote | covered | Sponsor package |
| Nadege coach | No sandbox / no batch-provision / no instructor view | 2w | 120-student-cohort revenue |

---

## §15. NEW — Engineering specialization roadmap (Wave B Batch 8)

**15 specialized engineering audits map to 9 product engineering investments — sequenced by dependency.** This is the 12-26 week roadmap for engineering above and beyond P0/P1 fixes.

| Investment | Source | Owner | Effort | Sequence |
|---|---|---|---|---|
| Vector retrieval (pgvector + ANN + cosine + hybrid) | Sayuri-Vatanen | 1 eng | 1w | Wk 14 |
| Search infrastructure (wire FTS layer 3 + pg_trgm + accent-folding) | Anaïs | 1 eng | 1w | Wk 14 (parallel) |
| Voice AI / TTS Phase 1 ("Read aloud") | Tariq, Beck | 1 eng | 1w | Wk 8 |
| Voice AI Phase 2 (streaming TTS) | Tariq | 1 eng | 2w | Wk 18 |
| Voice AI Phase 3 (voice-Pax field-mobile, wake-word, barge-in) | Tariq | 1 eng | 4w | Q4 2026 |
| Realtime WS + Redis pub/sub adapter | Sigrún | 1 eng | 1w | Wk 7 |
| ETL orchestrator (watermarks + DLQ + soft-delete propagation) | Wenzeslaus | 1 eng | 2w | Wk 10 |
| SBOM / supply chain / signed install | Sigvard | 1 eng | 1w | Wk 9 |
| Capacitor wrap shipping (`npx cap add ios/android` + 2 plugins build-out) | Andrei, Skye-A, Devika | 1 eng | 4w | Q3 2026 |
| Vision AI scheduled re-imaging + change detection (Ingrid wired) | Ingrid | 1 eng | 2w | Wk 12 |
| ML training instrumentation (snapshot capture for 18-mo training) | Magnus | 1 eng | 1w | Wk 11 |
| i18n infrastructure (Nakamura's 12w plan) | Nakamura | 1 eng | 12w | Q1 2027 (only if paying customer demands) |
| Real-native mobile (Capacitor wrap) | Andrei | 1 eng | 4w | Q3 2026 |
| MLS connector hardening (Adelaide §2) | Adelaide | 1 eng | 1q | Q4 2026 |

---

*— Master synthesis · 2026-05-01 · derived from 211 audits across two waves (86 Wave A + 125 Wave B). After this synthesis AcreOS has the definitive 211-persona audit and never needs to repeat the exercise. ~30,000 lines of audit input synthesized to ~3,500 lines of finding inventory.*
