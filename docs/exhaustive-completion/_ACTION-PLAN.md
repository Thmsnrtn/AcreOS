# AcreOS — Action Plan (Sequenced Execution)

**Date:** 2026-05-01
**Synthesis of:** **211 audits across two waves**
- **Wave A (86 audits)** — `elite-team-2026-05-01/` (12 strategic) + `elite-team-deep-2026-05-01/` (74 deep specialists)
- **Wave B (125 audits)** — `elite-team-deeper-2026-05-01/` (regional/niche + adversarial/a11y/bandwidth + ecosystem partners + lifecycle ops + specialized engineering)

**Companions:** `_QUICK-REFERENCE.md` (founder single-page) · `_MASTER-FINDINGS.md` (full deduped inventory).

This document converts the master findings into an **executable** sequence. Every line item is sized for one engineer + Claude (per CLAUDE.md). Work is sequenced **dependency-first** — prerequisites land before consequences. Wave B added 24 new P0 items, 25 new P1 items, and 10 new P3 deferral decisions; the 26-week sprint plan is preserved and extended with **Phases 7-9 covering ecosystem-partner enablement, engineering specialization, and lifecycle-ops product line**.

---

## §1. Launch-readiness path (Week 1-2) — extended for Wave B P0s

**Goal:** Stop the bleeding. The four explicit P0 security/legal bugs ship today; six tier-tables make every revenue number fiction; client-side idempotency gap means a single 502 = double-charge. **Wave B added 9 new P0s** that must ship in the same window. Until these land, no meaningful customer should pay.

### Week 1 — Tier truth, security P0s, idempotency, hardcoded EIN, Cesar TX disclosure, Aniyah Indian-Country block

**Day 1 (Mon) — Tier-truth single source + annual-SKU foundation.** *(Marisol §1, Tegan §2, Asher §4, Hassiba §1; Wave B: Magnolia §1, Cassiopeia §1, Lavender §WD-2)*
- Create `shared/billing/tier-pricing.ts` exporting `TIER_PRICES_CENTS` with `priceMonthlyCents` + `priceYearlyCents` peers.
- Codemod 6 conflicting sites.
- CI test that fails build if Stripe price IDs disagree.
- **Plus**: `billingInterval` field on `organizations` table (Magnolia §1).
- Owner: Thomas + 1 engineer. Effort: 1 day.
- Acceptance: `/founder-home` MRR matches Stripe within ±$0; `priceYearly` peer present; ready for Phase-3 annual-SKU rollout.

**Day 2 — Security P0s R1 + R4 + hardcoded EIN.** *(Sam §1; Wave B: Phineas-IRS §3, Olympia §1, Hilda §3, Martin §1)*
- R1: replace inline `org.ownerId` check with `isFounderAdmin`.
- R4: rip `routes-2fa.ts` + `require2FA.ts`; migrate to Clerk native MFA.
- **NEW — kill hardcoded `payerEin: "00-0000000"` and `recipientTin: "000-00-0000"` in `bookkeeping.ts:262, :266`.** Capture org `ein`, `taxIdType`, `taxAddress`, `legalEntityName` in onboarding (Blanco §3 + Martin §3). Pull into 1099 generator. CI test: no 1099 run produces `00-0000000`. **Plus**: rewrite `generate1099IntForms` to emit a 1099-INT-shaped record (current code emits 1098-INT shape — Olympia §1).
- Owner: 1 eng + Claude. Effort: 1 day.

**Day 3 — Security P0s R2 + R3.** *(Sam §1, Marguerite §2; Wave B: Cordelia §2.1, Caspian §1)*
- R2: reject `content` updates on `signed` documents. SHA-256 `documentContentHash` on `signatures`. Org-scope `updateGeneratedDocument`.
- R3: encrypt `skip_traces.results` + `skip_traces.input_data`; backfill migration. Flip `secretsValidation.ts:33` `FIELD_ENCRYPTION_KEY` `required: true`.
- Owner: 1 eng + Claude. Effort: 1.5 days.

**Day 4 — Client-side `Idempotency-Key` (extended).** *(Ines §1, Hessam §2; Wave B: Alaric §2.3)*
- Default `mutations.retry: false`.
- UUID per mutation in `apiRequest` when method POST/PATCH and `idempotent: true`.
- Wire: stripe/checkout, credits/purchase, e-sign send, campaign send, public sign, **+ refund (`Idempotency-Key: refund:${request.id}`) + Twilio messages + scheduled campaigns**.
- Owner: 1 eng. Effort: 1.5 days.

**Day 5 — Persona-architecture lint + customer-surface leaks (extended).** *(Vesna P0-1+P0-2, Asher §3, Mira §4.7, Hiroko §2.4; Wave B: Sigfried §1, Coriander §1.5, Lila §2)*
- Codemod the original 6 sites + 3 Wave B leaks.
- Custom ESLint rule `no-founder-codenames-in-customer-jsx`.
- **Plus Sigfried**: remove `/founder-dashboard` sidebar link with literal "legacy" string this week.
- **Plus Coriander**: enforce `readOnly: true` impersonation flag in middleware (currently a JSON comment).
- **Plus Lila**: scan all AI tool prompts visible-via-tool-output for founder-POV leaks.
- Owner: design-leaning eng. Effort: 1 day.

### Week 2 — E-sign idempotency, Twilio replay, F1+F2, encryption consolidation, Cesar TX + Aniyah blocks, Boniface drill kickoff

**Day 6 — `eSigningService.sendForSignature` row lock + Cesar TX §5.069 disclosure block.** *(Ines §1.3, Hessam §2.4; Wave B: Cesar §1, Marguerite §3.2, Cordelia §2.1)*
- Wrap external POST: `SELECT … FOR UPDATE`.
- **NEW — TX §5.069 / §5.072 disclosure embed on every contract-for-deed dispatch.** Block if state=TX, docType=contract_for_deed, disclosure missing. Hard 422 with friendly message. Per-state disclosure registry surfaced to `documentValidator`.
- Add NY §307 negotiable-instrument block (P1-31).
- Effort: 1.5 days.

**Day 7 — Twilio MessageSid + Dropbox-Sign event idempotency + Sigfried sunset dates.** *(Hessam §2.2 + §2.4; Wave B: Sigfried §1)*
- Unique partial index on `messages(externalId)`.
- Dropbox atomic claim.
- Fail-closed when webhook key missing.
- **NEW — Sigfried**: announce sunset date for `/api/portal/:accessToken/payment` etc. T+90, hard 410 Gone after. In-app banner for impacted users. Atlassian-Stride playbook.
- Effort: 1 day.

**Day 8 — F1 SSRF + F2 inbound-email auth + Aniyah `landStatus` enum + LAR overlay.** *(Felix F1, F2; Wave B: Aniyah §2)*
- `validateUrl()` mount.
- HMAC-body or SES/SNS sig on inbound email.
- **NEW — Aniyah**: add `landStatus` enum on properties (`fee / tribal_trust / individual_trust / restricted_fee / fee_within_reservation / off_reservation_trust / unknown`). Default `unknown`. BIA Land Area Representation (LAR) shapefile overlay on map. Block downstream auto-AVM/blind-offer/auto-doc when `unknown` or trust status. Red banner.
- Effort: 1.5 days.

**Day 9 — Encryption consolidation + Coriander recovery console scaffold.** *(Aravind §3.1; Wave B: Coriander §1)*
- Migrate `services/encryption.ts` callers to `fieldEncryption.ts`.
- **NEW — Coriander recovery console scaffolds (admin endpoints, no UI yet)**: `/api/admin/users/:id/2fa/reset` (with identity-proof), `/api/admin/users/:id/sessions` + `/sessions/:sid/revoke`, `/api/admin/users/:id/sessions/revoke-all-others`, `/api/admin/orgs/:id/freeze-autopay`, `/api/admin/orgs/:id/transfer-ownership` (with court-document upload). Identity-proof workflow scaffold.
- Effort: 2 days. UI shipped Week 13.

**Day 10 — SendGrid event webhook + invite-token hardening + Eleonora deliverability foundation kickoff.** *(Hessam §2.3, Pelle G/H/I; Wave B: Eleonora §1)*
- SendGrid webhook with Ed25519 sig.
- `email_events` + `email_suppressions` tables.
- Hash invite tokens (SHA-256). Per-org cap (100/day). Per-user accept-rate-limit (10/hr). Audit-log redaction.
- **NEW — Eleonora kickoff (foundation only this week)**: per-org DKIM identity provisioning, `List-Unsubscribe: <mailto:>` + `<https://>` headers on every send. (Bounce/complaint feedback loop, ARC sealing, IP warmup automation, per-org reputation isolation = Week 7-8.)
- Effort: 2 days.

**Acceptance for week 1-2:** all 24 P0 items in `_MASTER-FINDINGS.md` §1 closed (Wave A 15 + Wave B 9); CI gates added; ESLint rules active; Cesar TX disclosure block + Aniyah Indian-Country block live; recovery console backend endpoints exist (UI Week 13). Total cost: ~12 days of focused work, parallelizable across 2 engineers + Claude.

---

## §2. The 30-day quality sprint (Week 3-6) — extended for Wave B microcopy + lifecycle-ops urgency

**Goal:** Apple-stock-app feel where it isn't. Pricing-page split resolved; voice propagates across the auth wall; IA clarity (route collapse + settings cut + duplicate-route redirects); eval infrastructure v0; **plus Wave B "lifecycle-ops urgency" items: Vesper cancellation, Renoir reactivation, Magdalena import-ceiling, Boniface DR drill, monthly-close foundation, 1099 batch generator fix.**

### Week 3 — Voice + microcopy + pricing decision + read-aloud TTS Phase 1

- **Pricing decision (Thomas).** Operator-class. (P1-1) — 1.5d writing + 1d rollout
- **Microcopy janitorial sweep + plain-English error reasons + glossary tooltips + Pax response shape v2.** Codify `docs/voice.md`. Convert `error-utils.ts` to status-code classification. **Pax prompt v2: open with one-sentence headline + 3 bullets max, prose only when needed (Beck §2 + Reyna §2 fix).** Glossary tooltip registry (~30 terms — "yellow letter," "decision queue," "pulse," "last touch"). 4d. (P1-2)
- **Read-aloud TTS Phase 1 — `window.speechSynthesis.speak()` on every Pax response + every legal doc.** 2 lines of code per integration; ~12 sites. (Beck §2, Tobias §2, Mavis §2, Tariq §1) — 1d.
- **Founder letter discoverability + `/security` page + curated `/changelog`.** PageShell footer. Ship `/security`. Stop scrubbing dev CHANGELOG. 2.5d. (P1-5, P1-7, P1-8)
- **Cancellation flow that earns the FAQ + Vesper "Downgrade instead" wire-up.** ZIP export + T+12hr Thomas email. **Wire "Downgrade instead" to plan picker pre-selected to lower tier (Vesper §3 — currently calls `handleClose`).** Use cancellation-context usage panel as retention pitch. 2.5d. (P1-6 + Vesper §3)

### Week 4 — IA collapse + empty-state archetypes + reactivation context + URL routes for lead/deal

- **Cut `/settings` 17 → 7 tabs.** 5d. (P1-26)
- **Kill duplicate routes with 60-day redirects.** 1d. (P1-27)
- **Empty-state archetypes (First Hello / Cleared / Empty Filter).** 4d. (P1-4, P1-10)
- **NEW — Reactivation context endpoint + `eventType: 'reactivate'` written.** `/api/subscription/reactivation-context` returns last plan, tenure, grandfathered price, what's been added. 4d. (Renoir §1-§2)
- **NEW — URL routes for lead-detail + deal-detail.** `/leads/:id`, `/deals/:id` + URL-sync sheets. 3d. (P1-28)
- **NEW — Org-switcher in topbar.** Kill the 8-12 min nightly logout-login dance for VAs. 1d. (Reyna §2)

### Week 5 — Eval harness + AI cleanup + Read-aloud Phase 2 + indirect prompt-injection guard

- **Eval harness v0.** 50-prompt golden set. 3d. (P1-35)
- **Migrate top-10 direct-OpenAI bypass services.** 3d. (P1-36)
- **Kill `gpt-4-turbo-preview`** (4 sites). 0.5d. (P1-37)
- **Pax prompt v2 (rewrite from Theo §3.B + Beck §2 shape rule).** Versioned `prompts/pax_executive.v3.md`. Anthropic prompt caching. 1d. (P1-41)
- **Indirect-prompt-injection guard.** Apply `sanitizePrompt` to DB-sourced inbox/lead/property fields before interpolation. Sandbox with deterministic delimiters. Post-validators on draft. 2d. (P0-14, Nadia-AI §2.A, Lazlo §3)

### Week 6 — Client observability + content-hash + ESIGN + Boniface restore drill + monthly-close kickoff

- **Sentry hygiene.** `release: VITE_GIT_SHA`, `setUser` after auth, hard-fail source-map upload, `web-vitals`, `replayIntegration({ maskAllText: true })`. 2d. (P1-17, P1-18, P1-20)
- **Frontend `clientLogger`.** Replace 71 `console.*`. 1d. (P2-3)
- **Document content hash + signed-PDF archive + completion certificate.** 2d. (P1-30)
- **NEW — Boniface restore drill (the first one, ever).** Drill 1: Postgres restore from snapshot to `acreos-db-restoretest`. Document RTO/RPO actual measured numbers. Commit Bronze tier (1hr/1hr) publicly. 1d to run + 0.5d to document runbook. (Boniface §1-§3)
- **NEW — Lavender monthly-close kickoff: chart-of-accounts table.** Add `chart_of_accounts` table + `account_ledger_entries` (debit/credit framing). Migration only this week; recognition worker + trial-balance generator Week 10. 2d. (Lavender §1, Hilda §2)

**Acceptance for week 3-6:** voice scorecard +5 points; `_MASTER-FINDINGS.md` §2 down by 30 items; eval gate blocks PR drops > 5%; Read-aloud TTS Phase 1 live across Pax + legal docs; reactivation context endpoint live; first restore drill documented with measured RTO/RPO.

---

## §3. The 60-day scale-prep sprint (Week 7-14) — extended for Wave B foundation gaps

**Goal:** Survive 100 customers without panic. **Wave B adds: deliverability foundation (Eleonora), DNS/cert pipeline (Cuthbert), realtime Redis pub/sub (Sigrún), monthly-close infrastructure (Lavender), 1099 batch (Olympia), recovery console UI (Coriander), legal-hold mechanism (Saskia/Lazlo/Margolis), supply-chain SBOM (Sigvard).**

### Week 7-8 — Database + connection pool + jobs + Eleonora deliverability foundation + Sigrún realtime + Cuthbert DNS

- **pgBouncer transaction-pooling** + **Postgres extensions migration** (incl. `pgvector` for Sayuri-Vatanen and `pg_trgm` for Anaïs) + **index audit**. 2d (P1-15) + 0.5d (P2-11) + 1d
- **Background-jobs migration to self-rescheduling setTimeout.** 6 P0 jobs. 1w
- **DLQ + outbox table.** 2d
- **NEW — Eleonora deliverability foundation full.** Per-org DKIM, bounce/complaint feedback loop, ARC seal, IP warmup, per-org sender-reputation isolation. 4d. (Eleonora §1)
- **NEW — Sigrún Redis pub/sub adapter.** Without it, broadcasts on machine A invisible to clients on machine B with `min_machines_running=2`. Consolidate to single `useRealtime()` connection. Convert War Room + Agent Debate to WebSocket subscribers. 1w. (Sigrún §1, Salma §4)
- **NEW — Cuthbert white-label DNS/cert pipeline.** Pick one schema + one middleware. ACME pipeline (Caddy / Cloudflare-Origin-Certs / Lego). DNS-ownership verification. Redis pub/sub eviction across machines on tenant edits. Customer-facing CNAME instructions doc. **Or** explicit "white-label is paused" banner. **Founder decision required Week 7 — see Strategic Decision #4.** 1w. (Cuthbert §1)

### Week 9 — AI cost ceiling + per-org rate limits + cascade async + Sigvard SBOM

- **Per-org AI daily cost cap.** 2d
- **Per-org rate limit on `/api/ai*`.** 0.5d
- **Cascade async sample 10%.** 1d
- **Pax tool-loop streaming.** 1.5d
- **AI cost dashboard.** 1d
- **NEW — Sigvard SBOM** + signed npm install enforcement + secrets-in-CI scanning. 1w. (Sigvard §1)

### Week 10 — Stripe Tax + dunning channel + customer concentration + Lavender monthly-close + Olympia 1099 batch

- **Stripe Tax** + **pin Stripe `apiVersion`** + **dunning SMS leg** + **customer concentration alert** + **subscription event ledger** + **deferred-revenue table**. (Wave A — preserved.)
- **NEW — Lavender monthly-close core.** Trial balance generator. GL-detail PDF. IIF/QBO journal-entry export. Backfill from Stripe. 4d. (Lavender §1, Hilda §2)
- **NEW — Olympia 1099 batch generator.** Form 1099-INT + 1096 transmittal + IRS FIRE e-file submission. Multi-recipient. PDF + paper option. 4d. (Olympia §1)

### Week 11 — DSAR pipeline + sub-processor DPAs + audit log fan-out + Saskia/Lazlo legal-hold

- **DSAR pipeline (real one).** 4d (Anouk §2)
- **Sub-processor DPAs.** Ongoing — start outreach week 11; close all by week 18.
- **Audit-log fan-out + lockdown.** 2d (Sam §4)
- **NEW — Saskia/Lazlo/Margolis legal-hold mechanism.** `legal_holds` table + scope-resolution + `dataRetention.ts` LEFT JOIN exclusion + delete-blocker on every storage method + UI red banner. Compose `legalHold` org state from existing `simulated_actions` primitive (Margolis §1). 1w. (P0-23)

### Week 12 — Optimistic mutations + skeleton choreography + IA cross-page + Aniyah BIA workflow + ML training instrumentation

- **Optimistic-update sweep on top-5 verbs.** 5d (Bavo §2, Priya §2)
- **`<ContentReveal>` pattern across `/today`, `/leads`, `/properties`, `/deals`, `/inbox`.** 3d (Bavo §6)
- **`layoutId` cross-page handoff: parcel-card → /parcels/:id hero.** 2d (Lukas §3 S1)
- **NEW — Aniyah BIA workflow template** (manual operator-driven, not BIA-API-integrated). 1w. (Aniyah §3)
- **NEW — Magnus ML training instrumentation.** `ml_training_snapshots` table; capture labels (deal outcomes, AVM-vs-actual, lead conversion) + feature snapshots at decision time. Defer model training to month 18+. 1w. (Magnus §1)

### Week 13 — Founder-bottleneck mitigations + Coriander recovery-console UI ship

- **8 missing runbooks.** 1d (Olu §3, Beata §2)
- **Vendor-status tile.** 0.5d
- **P0/P1 escalation buddy + ack-timer.** 0.5d
- **GDPR + org-merge admin UIs.** 2d
- **Customer-context sidebar + saved-replies.** 1.5d (Olu §7 #5+#6, Kunle §2)
- **Synthetic checks.** 1d
- **Sophie HIL guard.** 0.5d
- **NEW — Coriander recovery console UI ship (backends shipped Week 2).** Sessions list/revoke UI, 2FA-reset UI with identity-proof workflow + review queue, autopay-freeze UI, ownership-transfer UI with court-document upload, password-reset-link generator. 1w. (Coriander §1, Asher-takeover §4, Cleo §1, Martin §3)

### Week 14 — RBAC repair + activation telemetry + retention infra + vector retrieval + search infrastructure

- **RBAC repair** (Liana §1+§3) + add `va` role (Reyna §1) + `co_owners` relation (Blanco §1). 3d
- **Activation telemetry.** 3d (Yuna §8)
- **Retention infra v0.** 3d (Konstantin §2)
- **NEW — Sayuri-Vatanen vector retrieval.** Migrate `embedding_vector` from jsonb → `vector(1536)`. IVFFlat or HNSW index. Cosine operator. Hybrid retrieval. Embedding refresh job. 1w. (Sayuri-Vatanen §1)
- **NEW — Anaïs search infrastructure.** Wire `/api/search` to `fullTextSearch.search()`. Add accent-folding + phone normalization to existing tsvector indexer. 1d. (Anaïs §2)

**Acceptance for week 7-14:** Wave A 100-customer tipping-point checks all green; **plus** deliverability foundation 8/10 (was 3/10), white-label TLS works for first reseller (or paused publicly), Redis pub/sub operational, monthly-close trial balance reconciles to bank, 1099 batch generator emits IRS-compliant FIRE-format files, recovery console UI shipped, legal-hold blocks deletes during pending litigation, vector retrieval at p99 < 50ms, fuzzy search wired everywhere ⌘K mounts.

---

## §4. The 90-day brand-and-narrative push (Week 15-26) — extended

**Goal:** Brand belief locks. Voice is one person. Visual system at majority adoption. Lifecycle program covers pre-trial through win-back. **Wave B adds: migration in/out parity (Magdalena/Tobiah), DR Silver tier (Boniface), partner-API tier kickoff (Hartwell pilot), accessibility full pass (Beck/Tobias/Mavis/Earl).**

### Week 15-16 — Visual + design-system propagation + migration in/out parity

- **Codemod hardcoded Tailwind color literals → `acr-*` tokens** (Calla §7). 1w
- **Build `<StatusBadge>` (consume `<StatusDot>`).** 1d
- **Verb canon `lib/labels.ts`.** 2d
- **Page-header + heading-discipline propagation.** 1w
- **NEW — Magdalena migration-in cap raise + history preservation.** Raise import cap to 50K rows (chunked + background job). Add `tags`, `communications.csv`, `documents.zip`, `assignedTo`, `createdAt` preservation. 1w. (Magdalena §1)
- **NEW — Tobiah migration-out single archive.** Consolidate four parallel export systems into one canonical `/api/export/everything` endpoint. Single ZIP. Single schema. 1w. (Tobiah §1)

### Week 17-18 — Lifecycle + retention + reactivation + 6-segment win-back

- **14-message lifecycle program shipped end-to-end.** 2w (Sigrid §3, Camila §4)
- **Activation cohort dashboard + churn-reason taxonomy + `cancellation_reasons` ledger.** 1w
- **NEW — Indigo 6-segment 2D matrix win-back.** reason × tier matrix; ethical-limit guardrails; ship-update flow fed from changelog. 1w. (Indigo §1-§4)
- **NEW — Renoir reactivation flow ship.** "What's new since you left" engine fed by changelog. Welcome-back surface. Pre-filled checkout for last plan. Cancellation-survey-pulled-back-to-user. 4d. (Renoir §1-§2)

### Week 19-20 — Spotlight (⌘K) v2 + Read-aloud Phase 2 (streaming TTS)

- **Server-side fuzzy search (`pg_trgm` similarity)** — already wired Week 14. Now: **matcher upgrade** (bigram + acronym + substring), **verb expansion 6 → 30**, **Pax inline preview + entity-resolution + scope filters**, **delete `/pax`, `/ai`, `/agents` routes (60-day redirect)**, **discoverability promotion**. (Anya §2-§7)
- **NEW — Tariq streaming TTS Phase 2.** ElevenLabs or OpenAI tts-1 streamed. Per-message Read-aloud upgrade from `speechSynthesis` to streaming. 2w. (Tariq §1, Beck §2)

### Week 21-22 — Eval depth + prompt versioning + AI safety + DR Silver tier

- **Compliance disclosure post-validator** (Opus 4.6 + extended thinking) + **80-conversation Pax executive eval set** + **Indirect-prompt-injection guard hardening** + **Prompt versioning + A/B harness**. (Theo §8, Sayuri §2.3, Nadia-AI §2.A — 1w each)
- **NEW — Boniface DR Silver tier (target).** HA Postgres + WAL archiving. RTO 30 min / RPO 15 min. +$60/mo. 4d. (Boniface §2)
- **NEW — Hartwell title-partner API pilot kickoff.** `POST /api/title-orders` endpoint + inbound title-status webhook + ALTA-Pillar-2 wire-instructions surface scaffolds. (Full implementation Phase 7.) 1w prep. (Hartwell §1)

### Week 23-26 — Founder dashboard rebuild + accessibility full pass (incl. Beck/Tobias/Mavis/Earl/Yelena) + SEO substance

- **`/founder-home` rebuild as CEO daily window.** 1w (Asher §8)
- **WCAG 2.2 AA full pass.** 55-site aria-label sweep; ChartPalette; per-route titles; SC 2.4.11 fix. **Plus Wave B accommodations**: Lexend pairing + reading density mode (Beck §2-§4), "more time, less density" cognitive-a11y mode (Tobias §1), visible button affordances + larger taps (Mavis §1), picture-first parcel cards (Earl §1), focus mode + enforced quiet hours in-app + wizard save-state (Yelena §1). 2w (Devereux §6, Reuben §2 + Wave B §13)
- **SEO substance.** 2w (Dilan §3)

**Acceptance for week 15-26:** primitives at >80% adoption; voice scorecard at 45/50; 14-message lifecycle program live; ⌘K is the spine; WCAG AA clean across customer surfaces + Wave B accessibility accommodations live; Magdalena migration cap raised to 50K with full history preservation; Tobiah single-archive export shipped; Hartwell title pilot in flight.

---

## §5. The 6-month roadmap (Week 27-52) — extended for vertical sequencing

### Vertical: Note Investor (Q4 2026)

(Wave A — preserved.)
- `acquired_notes` data model. 4w
- BPO + tape diligence workflow. 3w
- 1098-INT + 1099-INT batch generator (extends Olympia Phase-3 work). 4w
- Note assignment paperwork. 2w
- Sophie agent expansion. 4w
- Note-investor onboarding flow + persona-vocabulary. 1w

**Note-investor wedge target: Q1 2027 (week ~52). $300M TAM at $500/mo all-in.**

### Team-size readiness (concurrent with Note vertical)

- **Per-seat pricing** + **round-robin lead assignment** + **manager dashboard with real per-rep data** + **Slack/Teams integration** + **per-record owner enforcement + offer approval workflow**.
- **Plus Wave B**: `va` role + per-member activity report (Reyna §2); `co_owners` relation + dual-billing card + dual-tax-contact + LLC-EIN-on-Stripe-customer (Blanco §2-§3); successor / executor flow + death-cert intake + autopay holdback during gap (Martin §1-§3); Imelda-VA six-VA shop conditions.

**Team-of-3 ship target: Q4 2026 (week ~38).**
**Team-of-10 ship target: Q1 2027 (week ~50).**

### Accessibility full pass (concurrent — covered Phase 4)

---

## §6. The 12-month roadmap

What AcreOS looks like at week 52 if every sprint above ships:

- **Land Investor wedge: $10M ARR.** ~2,500 paying customers at $400/mo blended ARPU.
- **Note Investor live as second product.** 500 customers. $300/mo blended.
- **Tax-Delinquent vertical scoping.** Marcus's 5-state-rules table real; auction calendars wired.
- **Wholesale: NOT YET.**
- **Brand: locked.** Voice is one person. Persona architecture lint-enforced. ⌘K spine.
- **Compliance: SOC 2 Type 1 in flight.** Functional MFA, full audit-log + legal-hold + recovery console + estate flow + monthly close + 1099 batch + restore drill at Silver tier (RTO 30/RPO 15) committed.
- **Series-A: $12M at $60M post.** Ashok §1: contingent on (a) tier truth + event ledger + Stripe Tax + annual SKU (week 1-10 — done), (b) compliance posture (week 17-22 + Wave B legal-hold + recovery console — done), (c) NRR decomposition + customer-concentration (week 10 — done), (d) 10% MoM growth at $5M ARR. **Ashok's 4 things checked off by week 24.**
- **Team: Thomas + 4 engineers + 1 ops/CS.** No earlier; no later.
- **Multi-region: NOT YET.**
- **Family-office, Capital-markets, Wholesale, Imelda-grade Landlord, TIMO, Ag-REIT, RV-park, LP-fund, 1031-QI, Mineral, Ground-lease, Pre-development: P3.** Defer past month 12.

---

## §7. NEW — Phases 7-9 (Months 7-18)

These are the Wave B-driven bigger projects that don't fit the 26-week core sprint plan but are essential to the 18-month picture.

### Phase 7 — Ecosystem partner enablement (Months 7-9)

**Driver:** Wave B Theme 7. 16 partner audits all converge on the same diagnosis: AcreOS has the framework but no partner-tier API.

**Sequence:**

| Sprint | Investment | Source | Effort | Revenue impact |
|---|---|---|---|---|
| Mo 7 | **Hartwell title-partner API full** — `POST /api/title-orders`, inbound title-status webhook, ALTA-Pillar-2 wire-instructions surface (out-of-band confirmation, encrypted PDF, signed), commitment/policy/Schedule-B exchange format, partner registry, volume-pricing tier | Hartwell §1-§3, Esther §1, Zephyr §1 | 6w | $895/file × 28-32 closings/mo at scale |
| Mo 7-8 | **Stanton Lob depth + four-module consolidation** — NCOA at ingest, USPS Move Update, webhook listener, return-mail flow, template registry, A/B harness, batch endpoint. **Plus**: consolidate `directMailService.ts`, `directMail.ts`, `mailProvider.ts`, `lobService.ts` into one module | Stanton §1, Kira-A A1 | 2w | Enterprise discount + reduced fraud risk |
| Mo 8 | **Beaufort auction integration** — replace `generateMockAuctionData` with calendar-federation API consumer; inbound auction-results webhook; deposit-rule JSONB; `auctionDirection: high_bid \| low_bid`; partner-credentials vault | Beaufort §3, Rina §2 | 1q | Federation deal possible |
| Mo 9 | **Adelaide NAR / Reginald MLS** — first: trademark fix (1d). Then: RESO certification + flow-down agreements + sold-data restriction enforcement + render-layer fair-housing disclaimer wired to governance engine | Adelaide §1-§4, Reginald §1-§3 | 1q | NAR member-benefits inclusion |
| Mo 9 | **Caspian skip-trace partnership remediation** — purpose-of-use attestation, lead-binding, suppression-list integration. (Mostly covered P0-5 + P1-34.) | Caspian §1 | covered | Continued partnership |

**Partner-API tier acceptance:** four partners (title, mail, auction, MLS) on partner-tier APIs by month 9. Six engineering deliverables (per Stanton §1) shipped as a coherent partner program.

### Phase 8 — Engineering specialization (Months 10-12)

**Driver:** Wave B Batch 8 + Engineering specialization roadmap (§15 of `_MASTER-FINDINGS.md`).

| Sprint | Investment | Source | Effort |
|---|---|---|---|
| Mo 10 | **Andrei Capacitor wrap shipping** — `npx cap add ios/android`. Apple Developer + Play Console enrollment. Background-location + iOS push (the two load-bearing plugins). App-store listing per Bertha §3-§4. | Andrei §1, Skye-A §6, Devika §1, Bertha §1-§3 | 4w |
| Mo 10-11 | **Voice AI Phase 3 — voice-Pax field mobile, wake-word, barge-in, streaming TTS playback, language detection** | Tariq §1 | 4w |
| Mo 11 | **Wenzeslaus ETL orchestrator** — watermarks, DLQ + replay, soft-delete propagation, cron orchestrator | Wenzeslaus §1 | 2w |
| Mo 11 | **Ingrid vision-AI scheduled re-imaging + change detection** wired to `routes-portfolio-sentinel` | Ingrid §1 | 2w |
| Mo 12 | **Yara EXIF / photo-hash pipeline** + **Vesna polish-and-poish** + **Beatriz LCP/CLS/INP optimization sprint** | Yara §1, Beatriz §1-§3 | 2w |

### Phase 9 — Lifecycle-ops product line (Months 13-18)

**Driver:** Wave B Theme 6. 25 lifecycle audits map to 8 phases.

| Quarter | Phase | Source | Effort |
|---|---|---|---|
| Mo 13-14 | **Constance/Henrik bankruptcy panel** — post-petition payments separator, §704 trustee-mode, automatic-stay flagging, 11 USC §362 surfaces | Constance §1, Henrik §1 | 4w |
| Mo 13-14 | **Penelope probate inventory** — DoD step-up basis, frozen "as-of DoD" snapshot, beneficiary entity, multi-state ancillary, 706 worksheet, fiduciary accounting | Penelope §1 | 4w |
| Mo 14-15 | **Bartholomew/Phineas-IRS audit-packet endpoint** + **Jorge state-auditor surface** | Bartholomew §1, Phineas-IRS §1, Jorge §1 | 4w |
| Mo 15-16 | **Persephone annual review composer** — IRR + cost basis + diversification + P&L + cohort + tax-optimization + usage-logs into one annual-review PDF artifact | Persephone §1 | 4w |
| Mo 16-17 | **Eulalia RON build-out** — notary-officer flow + identity-proofing + audio-video recording + electronic notary journal + jurisdictional enforcement | Eulalia §1 | 4w |
| Mo 17-18 | **Cassiopeia in-product expansion offer surface** — "expand to scale tier" flow that doesn't require a sales call | Cassiopeia §1 | 2w |
| Mo 17-18 | **Galen concierge-program automation** — column mapper for Operator imports, de-dupe primitive, region-tune presets for AI agents, team-setup wizard, founder-mode demo runbook | Galen §1 | 4w |

**Lifecycle-ops product-line acceptance:** all 25 Wave B Batch 7 audit gaps closed by month 18. AcreOS ships a recovery console, estate-executor flow, monthly close, 1099 batch, IRS audit packet, state-auditor surface, annual review, RON, expansion offer, concierge automation. **The lifecycle-ops surface is now a published product line, not a retroactive scramble per ticket.**

---

## §8. What to NOT do (extended explicit out-of-scope list)

This list exists because every persona who flagged these is unanimous: doing them now is a strategic distraction.

### Wave A list (preserved — 12 items)

| # | Don't | Why | Who flagged |
|---|---|---|---|
| 1 | Don't build family-office multi-entity | Theodora explicit no | Theodora |
| 2 | Don't build true capital-markets (PPM, waterfall, Form D) | Otto: position upstream as data feed | Otto |
| 3 | Don't reach for Customer.io / Iterable / Braze before 1,000 customers | Sigrid + Camila: ship 14-message program first | Sigrid, Camila |
| 4 | Don't ship Wholesale, Tenant CRM, full Subdivision before Land hits $10M ARR | Linnea + Trey + Brigid + Imelda: renaming != data model | Linnea, Trey, Brigid, Imelda, Marcus, Ana, Asher |
| 5 | Don't add a 5th theme; don't ship a "Landlord" persona slot | Imelda: 20% built | Imelda, Wendell |
| 6 | Don't build a "real estate attorney"-grade purchase-contract layer in-house | Whitman: integrate doc-prep service | Whitman |
| 7 | Don't ship audio sound effects at launch | Sven: hasn't earned the right | Sven |
| 8 | Don't run Product Hunt as the launch | Greta: save for milestone | Greta |
| 9 | Don't migrate to multi-region before tripwires | Salma | Salma |
| 10 | Don't hire "support team" before fixing L2 escalation gap | Olu | Olu |
| 11 | Don't enable real-time voice AI before adoption signals | Sandeep + Mateo | Sandeep, Mateo, Tariq |
| 12 | Don't ship persona codenames in customer UI even by accident | 13 personas | Asher, Vesna, Mira, Hiroko, Tomás, Theo, Yusuf, Joaquín, Eden, Ana, Sigfried, Coriander, Lila |

### Wave B additions (10 new items)

| # | Don't | Why | Who flagged |
|---|---|---|---|
| 13 | **Don't build a TIMO institutional product (timberland fund tooling).** | Burt: "no, and it is not trying to. Leave off the roadmap." | Burt |
| 14 | **Don't build the ag-REIT institutional farmland product (farm-manager-tenant-operator triangle).** | Frederick: "selling AcreOS to ag-REITs as it stands today would be selling a CRM to people who don't have a sales pipeline." | Frederick |
| 15 | **Don't build the LP-fund full stack (capital accounts, NAV, waterfall, K-1, audit packet).** | Tristan + Preston + Rashad converge: zero plumbing today; "vocabulary without plumbing." Camille-institutional confirms aggregator angle is more interesting than fund-tooling. | Tristan, Preston, Rashad, Camille-inst |
| 16 | **Don't build the 1031-QI back-office partner integration.** | Kassidy: "a deadline calendar with a PDF generator stapled to it." Get items 1-10 of in-house exchange shipping right first. | Kassidy |
| 17 | **Don't build the RV-park / mixed-use developer SKU.** | Lila: AcreOS is front-of-funnel only; integrate Procore/Buildertrend on the back end if at all. Don't pretend you carry from raw dirt to stabilized 200-pad park. | Lila |
| 18 | **Don't build the ground-lease / cell-tower / pad-site / commercial-land vertical.** | Quentin + Sebastian: residential lease schema is wrong shape. | Quentin, Sebastian |
| 19 | **Don't build the mineral-rights vertical.** | Saoirse: 12-month build with domain expert in the room. Don't market "Land OS" as a minerals product. | Saoirse |
| 20 | **Don't build the pre-development (730-day cycle) product surface.** | Otto: `developer` enum exists in `businessType` but `dueDiligenceEngine` has 3 BusinessDDType values none of which are mine. The mismatch is the whole story. | Otto |
| 21 | **Don't build full i18n infrastructure until a paying second-locale customer demands it.** | Nakamura: 12-week build, not a config flag. Confirmed by Camille-FC, Esperanza, Mateus, Linh, Heng. Defer 12 months unless paying customer demands FR-CA or ES-MX. | Nakamura, Camille-FC, Esperanza, Mateus, Linh, Heng |
| 22 | **Don't build a Salesforce ISV listing until a Penelope-tier customer demands it.** | Iolanda: 6w project + AppExchange listing process. | Iolanda |

---

## §9. Per-week sprint breakdown (first 90 days) — extended

Assumes one engineer + Claude. Each week ships in canary first; 24-48hr soak before flag-flip.

| Week | Sprint | Wave A deliverables | NEW Wave B deliverables | Owner |
|---|---|---|---|---|
| **1** | Tier truth + R1+R4 + Idempotency-Key | Single `tier-pricing.ts`; founder-check fixed; Clerk MFA migrated; client UUID-per-mutation | **+ priceYearly + billingInterval + Magnolia annual SKU foundation; + hardcoded EIN kill (Phineas/Olympia/Hilda/Martin); + 1099-INT shape fix (Olympia)** | Thomas + 1 eng |
| **2** | E-sign idempotency + Twilio + F1+F2 + encryption | E-sign row lock; Twilio MessageSid unique; SSRF; SendGrid event webhook; invite-token hash | **+ Cesar TX §5.069 disclosure block; + Aniyah `landStatus` enum + LAR overlay; + Sigfried sunset-date on borrower endpoints; + Coriander recovery-console backend scaffold; + Eleonora deliverability foundation kickoff (DKIM + List-Unsubscribe)** | 1 eng |
| **3** | Pricing decision + microcopy + founder letter | Operator-class tiers; voice `docs/voice.md`; `/security` page; curated `/changelog` | **+ Pax response shape v2 (headline + 3 bullets); + Read-aloud TTS Phase 1 (`speechSynthesis`); + glossary tooltip registry; + Vesper "Downgrade instead" wire-up** | Thomas + design + 1 eng |
| **4** | Settings 17→7 + duplicate routes + empty states | 7 settings tabs; 6 redirects; 3 archetypes; FirstDayHero | **+ /api/subscription/reactivation-context; + URL routes for /leads/:id, /deals/:id; + org-switcher in topbar (Reyna)** | 1 eng |
| **5** | Eval harness + AI bypass migration + Pax v2 + injection guard | 50-prompt golden set; 10 services migrated; `gpt-4-turbo-preview` killed; Pax exec rewritten + cached | **+ indirect-prompt-injection guard (Lazlo + Nadia-AI)** | 1 eng |
| **6** | Sentry hygiene + content hash + ESIGN | `release` tag + setUser; web-vitals; replay PII mask; documentContentHash + signed-PDF archive | **+ Boniface restore drill (the first one); + Lavender chart-of-accounts table migration** | 1 eng |
| **7** | pgBouncer + Postgres extensions + index audit + foundation infra | App-side pool 5; pg_stat_statements live; 13 indexes added | **+ pgvector + pg_trgm extensions; + Eleonora full deliverability foundation; + Sigrún Redis pub/sub adapter; + Cuthbert white-label DNS/cert pipeline (founder strategic decision required)** | 1 eng |
| **8** | Background jobs + DLQ + supply chain | 6 P0 jobs self-rescheduling; outbox table | **+ Sigvard SBOM + signed npm install + secrets-in-CI** | 1 eng |
| **9** | AI cost ceiling + per-org rate limit + cascade async + tool-loop streaming | `org_ai_quota_daily_usd`; per-feature p95/cost dashboard; SSE Pax exec | (Wave A only) | 1 eng |
| **10** | Stripe Tax + dunning SMS + customer concentration + ledger + close core | `automatic_tax`; apiVersion pinned; SMS dunning; concentration alert; `subscription_history` + `deferred_revenue` | **+ Lavender trial-balance generator + GL-PDF + IIF/QBO journal export; + Olympia 1099 batch generator (1099-INT + 1096 + IRS FIRE)** | 1 eng |
| **11** | DSAR + DPA outreach + audit log + legal-hold | Public DSAR intake → fan-out; audit-log fan-out; REVOKE | **+ Saskia/Lazlo/Margolis legal-hold mechanism + UI red banner + delete-blocker** | 1 eng |
| **12** | Optimistic mutations + skeleton choreography + layoutId hero + ML instrumentation | 5 verbs optimistic; ContentReveal; parcel-card → /parcels/:id morph | **+ Aniyah BIA workflow template; + Magnus ML training instrumentation** | 1 eng |
| **13** | Founder-bottleneck mitigations + Coriander recovery console UI | 8 missing runbooks; vendor-status tile; escalation buddy; GDPR/org-merge UI; customer-context sidebar; saved-replies; synthetic checks; Sophie HIL guard | **+ Coriander recovery console UI (sessions + 2FA reset + autopay-freeze + ownership-transfer + password-reset-link generator)** | 1 eng + Thomas |
| **14** | RBAC repair + activation telemetry + retention infra + vector + search | 4 pragmatic roles; `viewOnlyAssignedLeads` honored; activation_events/retention_events/cohort_assignments/churn_reasons | **+ `va` role + `co_owners` relation; + Sayuri-Vatanen pgvector retrieval; + Anaïs search infrastructure wiring** | 1 eng |
| **15-16** | Visual primitives propagation + migration in/out parity | acr-* token codemod; StatusBadge; verb canon; PageHeader | **+ Magdalena 50K row migration cap + history preservation; + Tobiah single-archive export consolidation** | 1 eng |
| **17-18** | 14-message lifecycle program + Indigo win-back + Renoir reactivation | Welcome / re-entry / morning-briefing / D7 / D30-NPS / pre-churn ladder / win-back | **+ Indigo 6-segment 2D matrix; + Renoir reactivation surface (welcome-back, what's-new, pre-filled checkout)** | 1 eng + design |
| **19-20** | ⌘K v2 + delete `/pax` route + streaming TTS Phase 2 | Server pg_trgm; matcher upgrade; verb expansion; rail-as-only-Pax-page | **+ Tariq streaming TTS (ElevenLabs or OpenAI tts-1)** | 1 eng |
| **21-22** | Eval depth + compliance post-validator + injection hardening + DR Silver | 80-conversation Pax eval; compliance Opus + post-validator; sanitize DB-sourced; pax_v3 shadow harness | **+ Boniface DR Silver tier (HA Postgres + WAL archiving, RTO 30/RPO 15); + Hartwell title-pilot endpoint scaffolds** | 1 eng |
| **23-26** | /founder-home rebuild + WCAG AA full pass + SEO substance + Wave B accessibility accommodations | CEO daily window; 55-site aria; ChartPalette; per-route titles; per-page OG/JSON-LD; SSR marketing routes; MDN-tier glossary | **+ Beck Lexend pairing + reading density; + Tobias cognitive-a11y mode; + Mavis older-user accommodations; + Earl picture-first; + Yelena focus mode + enforced quiet hours + wizard save-state** | 1 eng + design |

**Total cost estimate at one engineer + Claude per week: ~26 weeks plus Phases 7-9 (months 7-18); two engineers parallelize most of weeks 7-26 to ~16 weeks.**

---

## §10. Success metrics (how we know each sprint shipped)

| Sprint | Pass criterion |
|---|---|
| Week 1-2 (launch readiness, Wave A + B P0s) | All 24 P0 items in `_MASTER-FINDINGS.md` §1 closed; ESLint guards live; canary blue; zero double-charges in soak; `payerEin: "00-0000000"` removed; Cesar TX disclosure block + Aniyah Indian-Country block live; recovery console backend endpoints exist. |
| Week 3-6 (quality sprint) | Voice scorecard 32 → 40/50; empty-state coverage 35 ad-hoc → 0; `/settings` 17 → 7 tabs; eval gate blocks PR drops > 5%; Read-aloud TTS Phase 1 live; reactivation context endpoint live; first restore drill documented. |
| Week 7-14 (scale prep) | Elliot §2 100-customer tipping-point checks all green; AI cost at 100 customers projected $24K → $10K/mo; founder-time per week ≤ 15 hrs at 50 customers; **plus**: deliverability 8/10 (was 3/10), white-label TLS works for first reseller (or paused publicly), Redis pub/sub operational, monthly close trial-balance reconciles to bank, 1099 batch generates IRS-compliant FIRE files, recovery console UI shipped, legal-hold blocks deletes during pending litigation, vector retrieval p99 < 50ms, fuzzy search wired everywhere ⌘K mounts. |
| Week 15-26 (brand push) | acr-* token adoption ≥80%; lifecycle program 12 of 14 messages firing; ⌘K is the spine; WCAG AA clean + Wave B accommodations live; Magdalena 50K migration shipped; Tobiah single-archive export shipped; Hartwell title pilot in flight; DR Silver tier committed publicly. |
| 6-month (vertical + team) | Note Investor wedge: 50 paying note customers; Sophie agent at full mode; Team-of-3 product live (Vincent + Reyna `va` role); team-of-10 product in canary; **plus**: title-partner-API tier live with 1+ pilot title agency; lifecycle-ops phase 9 sprint kicked off. |
| 12-month | $10M ARR Land + $1.5M ARR Note; Series-A IC memo (Ashok §1) clears all 4 gating items + Wave B compliance posture (recovery console + estate flow + monthly close + 1099 batch + restore-drill-Silver-tier all shipped); SOC 2 Type 1 audit kicked off; brand voice = one person across every surface; **plus**: Hartwell + Stanton + Beaufort + Adelaide partner-API tier live; Wave B vertical-non-fits explicitly published as out-of-scope. |
| 18-month | Phase 9 lifecycle-ops product line shipped (recovery console, estate, bankruptcy, probate, IRS audit packet, state auditor, annual review, RON, expansion offer, concierge automation). 211-persona audit gaps reduced by ≥85%. |

---

*— Master action plan · 2026-05-01 · cohering 211 audits · directly executable per CLAUDE.md (one engineer + Claude pair). After this synthesis the audit cycle closes; the next deliverable is a 6-month progress check, not another audit wave.*
