# AcreOS — Action Plan (Sequenced Execution)

**Date:** 2026-05-01
**Synthesis of:** 86 audits in `elite-team-2026-05-01/` (12) + `elite-team-deep-2026-05-01/` (74)
**Companions:** `_QUICK-REFERENCE.md` (founder single-page) · `_MASTER-FINDINGS.md` (full deduped inventory)

This document converts the master findings into an **executable** sequence. Every line item is sized for one engineer + Claude (per CLAUDE.md). Work is sequenced **dependency-first** — prerequisites land before consequences. The 90-day per-week breakdown is in §8.

---

## §1. Launch-readiness path (Week 1-2)

**Goal:** Stop the bleeding. The four explicit P0 security/legal bugs ship today; six tier-tables make every revenue number fiction; client-side idempotency gap means a single 502 = double-charge. Until these land, no meaningful customer should pay.

### Week 1 — Tier truth, security P0s, idempotency

**Day 1 (Mon) — Tier-truth single source.** *(Marisol §1, Tegan §2, Asher §4, Hassiba §1)*
- Create `shared/billing/tier-pricing.ts` exporting `TIER_PRICES_CENTS`.
- Codemod 6 conflicting sites: `pricing.tsx`, `storage.ts:3452`, `routes-admin.ts:3293,3373,3685`, `routes.ts:1443`, `agents/revenue.ts:14`, `expansionRadar.ts:55`, `autonomousSalesPipeline.ts:309`, `shared/schema.ts:2937`.
- Add CI test that fails the build if Stripe price IDs disagree with the table at test time.
- Owner: Thomas + 1 engineer. Effort: 1 day.
- Acceptance: `/founder-home` MRR matches Stripe within ±$0.

**Day 2 — Security P0s R1 + R4.** *(Sam §1)*
- R1: replace inline `org.ownerId` check at `routes-admin.ts:465, :485` with `isFounderAdmin`. Ship regression test that calls `/api/founder/feature-requests` as non-founder org owner; assert 403.
- R4: rip `routes-2fa.ts` (184 lines) and `require2FA.ts` (55 lines). Migrate to Clerk native MFA.
- Owner: 1 engineer + Claude pair. Effort: 1 day.
- Acceptance: regression tests pass; 2FA enrollment works end-to-end via Clerk widget.

**Day 3 — Security P0s R2 + R3.** *(Sam §1, Marguerite §2)*
- R2: reject `content` updates on `signed` documents in `storage.updateGeneratedDocument` at `storage.ts:5643`. Add `documentContentHash` (SHA-256) column on `signatures`; persist at sign time. Make `organizationId` mandatory on `updateGeneratedDocument`; fix 4 callers in `routes-doc-system.ts`.
- R3: add `skip_traces.results` and `skip_traces.input_data` to `SKIP_TRACE_SENSITIVE_FIELDS` in `fieldEncryption.ts`. Ship one-shot backfill migration job. Flip `secretsValidation.ts:33` `FIELD_ENCRYPTION_KEY` `required: true` (gated on `productionOnly`).
- Owner: 1 engineer + Claude. Effort: 1.5 days.
- Acceptance: signed-doc-mutation test 422s; `pg_dump` of `skip_traces.results` shows `enc:v1:` prefix only.

**Day 4 — Client-side `Idempotency-Key`.** *(Ines §1, Hessam §2)*
- Default `mutations.retry: false` in `client/src/lib/queryClient.ts:329-339`.
- Generate UUID per mutation in `apiRequest` when method is POST/PATCH and `idempotent: true` flag is set.
- Wire into: stripe/checkout, credits/purchase, e-sign send, campaign send, public sign.
- Owner: 1 engineer. Effort: 1.5 days.
- Acceptance: artificially cause a retry on Stripe checkout; observe single Stripe Customer.

**Day 5 — Persona-architecture lint + obvious customer-surface leaks.** *(Vesna P0-1+P0-2, Asher §3, Mira §4.7, Hiroko §2.4)*
- Codemod 6 sites: `empty-states.tsx:128`, `today.tsx:686-690`, `today.tsx:1212`, `today.tsx:1229`, `coverage-page.tsx:236`, `executive.ts:325` description + `:339` Sophie redirect.
- Add custom ESLint rule `no-founder-codenames-in-customer-jsx` banning `Atlas\|Sophie\|Forge\|Sentinel\|Sovereign` literals in any TSX outside `/founder*`, `/admin*`, `/sovereign*`, `/data-moat*`, `/agent-*`.
- Owner: design-leaning engineer. Effort: 0.5 day.

### Week 2 — E-sign idempotency, Twilio replay, F1+F2, encryption consolidation

**Day 6 — `eSigningService.sendForSignature` row lock.** *(Ines §1.3, Hessam §2.4)*
- Wrap external POST: `SELECT signature_request_id FROM generated_documents WHERE id = $1 FOR UPDATE`. Return existing if non-null + non-expired. Pass `documentId` as e-sign provider's idempotency key.
- Owner: 1 engineer. Effort: 0.5 day.

**Day 7 — Twilio MessageSid + Dropbox-Sign event idempotency.** *(Hessam §2.2 + §2.4)*
- Unique partial index on `messages(externalId) WHERE externalId IS NOT NULL`. Insert with `.onConflictDoNothing()`.
- Atomic claim for Dropbox Sign: `INSERT INTO esign_processed_events (provider, event_id) VALUES (...) ON CONFLICT DO NOTHING` using `event.event_hash` (or `(provider, signature_request_id, event_type, event_time)` hash). State-machine guard (forward-only).
- Fail-closed when Dropbox webhook key missing in production.
- Owner: 1 engineer. Effort: 1 day.

**Day 8 — F1 SSRF + F2 inbound-email auth.** *(Felix F1, F2)*
- Mount `validateUrl(url)` before both `POST /api/webhooks/test` and the production `webhookDispatcher.ts:215` `fetchWithRetry`. Add post-DNS-resolution re-check.
- Implement HMAC-body or SES/SNS signature on `/api/webhooks/inbound-email`; reject without it.
- Owner: 1 engineer. Effort: 1 day.

**Day 9 — Encryption consolidation.** *(Aravind §3.1)*
- Migrate `services/encryption.ts` callers (Stripe/Twilio/Mapbox creds + OAuth tokens) to `fieldEncryption.ts`. Single key, single rotation procedure, single wire format.
- Owner: 1 engineer + Claude. Effort: 2 days.

**Day 10 — SendGrid event webhook + invite-token hardening.** *(Hessam §2.3, Pelle G/H/I)*
- Implement `POST /api/webhooks/sendgrid/events` with Ed25519 signature verification. Persist `email_events` + `email_suppressions` tables. `emailService.sendEmail` consults suppressions before every send.
- Hash invite token (SHA-256) at storage; redact from `audit_log.metadata`. Per-org `maxInvitesPerDay` (100). Per-user accept rate-limit (10/hr).
- Owner: 1 engineer. Effort: 1.5 days.

**Acceptance for week 1-2:** all 12 P0 items in `_MASTER-FINDINGS.md` §1 closed; CI gates added; ESLint rule active. Total cost: ~10 days of focused work, parallelizable across 2 engineers + Claude.

---

## §2. The 30-day quality sprint (Week 3-6)

**Goal:** Apple-stock-app feel where it currently isn't. Pricing-page split resolved; voice propagates across the auth wall; IA clarity (route collapse + settings cut + duplicate-route redirects); eval infrastructure v0.

### Week 3 — Voice + microcopy + pricing decision

- **Pricing decision (Thomas).** Operator-class ($249/$499/$1,290) per Tegan §3 + Asher §4. Rewrite tier descriptions in letter voice. Single source already shipped (week 1). 1.5 days writing + 1 day rollout. (P1-1)
- **Microcopy janitorial sweep.** Strip 11 `Please`s in `inbox.tsx`; 4 `successfully` adverbs; 3 `!` exclamations; 8 Title-Case dialog titles. Codify `docs/voice.md` (per Mira §6, Hiroko §6). Convert `error-utils.ts` to status-code classification. 4 days. (P1-2)
- **Founder letter discoverability + `/security` page + curated `/changelog`.** PageShell footer: "Why this exists →." Ship `/security` (Asher §6). Stop scrubbing dev CHANGELOG; biweekly customer-voice changelog. 2.5 days. (P1-5, P1-7, P1-8)
- **Cancellation flow that earns the FAQ.** One-click "Export everything" → ZIP + T+12hr automated email signed by Thomas. 2 days. (P1-6)

### Week 4 — IA collapse + empty-state archetypes

- **Cut `/settings` 17 → 7 tabs.** Per Karri §1+§7. Hash redirects: `#general → #billing`, `#security → #account`, etc. Move Goals/Automations/AI-Tasks/Referral out of Settings. 5 days.
- **Kill duplicate routes with 60-day redirects.** `/pipeline → /deals`, `/money → /finance`, `/dashboard → /`, `/command-center → /`, `/founder-dashboard → /founder`, `/founder-home → /founder`. Per Holm §6 step 2. 1 day.
- **Empty-state archetypes (First Hello / Cleared / Empty Filter).** Replace 35 ad-hoc `<p>No X yet.</p>` with `<EmptyState>` consumers. Fix `leads.tsx:1505-1507, 1661-1663` filter-empty (no Reset CTA). New `<FirstDayHero/>` for zero-data `/today`. 4 days. (P1-4, P1-10)

### Week 5 — Eval harness + AI cleanup

- **Eval harness v0.** Golden-set fixtures (50 inbox-draft prompts), Sonnet-as-judge runner, banned-phrase regex hard-fail, persona-leak hard-fail, score thresholds in CI. 3 days. (P1-35, Sayuri §2)
- **Migrate top-10 direct-OpenAI bypass services to `routeAITask`.** Targets: `supportBrain.ts`, `aiTutor.ts`, `complianceAI.ts`, `leadNurturer.ts`, `aiOfferService.ts`, `negotiationCopilot.ts`, `customerNarrative.ts`, `visionAI.ts`, `voiceAI.ts`, `acreOSValuation.ts`. 3 days. (P1-36)
- **Kill `gpt-4-turbo-preview`** (4 sites). Pin every callsite to dated model. CI test for pin compliance. 0.5 day. (P1-37)
- **Pax prompt v2 (rewrite from Theo §3.B).** Remove "AI-powered" + Sophie leak. Move to versioned `prompts/pax_executive.v3.md`. Enable Anthropic prompt caching. 1 day. (P1-41, Yusuf B)

### Week 6 — Client observability + content-hash + ESIGN

- **Sentry hygiene.** `release: VITE_GIT_SHA`, `setUser` after auth, `setTag('plan')` + `setContext('org')`, hard-fail source-map upload, `web-vitals` package + `browserTracingIntegration`, `replayIntegration({ maskAllText: true })`, port `maskString` to `shared/pii.ts`. 2 days. (P1-17, P1-18, P1-20)
- **Frontend `clientLogger`.** Replace 71 `console.*` calls. Flip `no-console: error`. 1 day. (P2-3)
- **Document content hash + signed-PDF archive + completion certificate.** ESIGN element 4 + 5 closure. 2 days. (P1-30, Marguerite §2)
- **Block native e-sign for NY-state negotiable instruments.** Show wholesaler-license warning when state ∈ {IL, OK, SC, …}. 1 day. (P1-31)

**Acceptance for week 3-6:** voice scorecard +5 points; `_MASTER-FINDINGS.md` §2 down by 25 items; eval gate blocks PRs that drop quality > 5%; 60-day redirect grace clock running on all old URLs.

---

## §3. The 60-day scale-prep sprint (Week 7-14)

**Goal:** Survive 100 customers without panic. DB connection ceiling, AI cost ceiling, job overlap ceiling, founder-time ceiling — all addressed before the first one fires at 2am on a Tuesday.

### Week 7-8 — Database + connection pool + jobs

- **pgBouncer in transaction-pooling mode.** App-side pool to 5; pgBouncer pool to 30. Buys to 1000+. (Adriana §6, Bjorn §3, Salma §4) 2 days.
- **Postgres extensions migration.** `pg_stat_statements`, `pg_trgm`, `btree_gin`, `pgcrypto`. Restart Fly Postgres once. (Nadia-PG §2) 0.5 day.
- **Index audit follow-up.** Top 13 missing indexes from Adriana §2: `inbox_messages` org-scoped, `team_messages` composite, lead/property/deal partial deleted_at, BRIN on append-only created_at on audit_log/system_activity, partial WHERE is_read=false on notifications. 1 day.
- **Background-jobs migration to self-rescheduling setTimeout.** 6 P0 jobs (api_queue, lead_nurturing, finance_agent, autonomous_decision_executor, growth_automation, agent_proactive_engine). Per-job timeouts via AbortController. Persistent failure counter in `jobHealthLogs`. (Iván §3, Ines §3) 1 week.
- **DLQ + outbox table for AI/Stripe/Twilio side-effects.** A Fly restart mid-job no longer double-charges. 2 days.

### Week 9 — AI cost ceiling + per-org rate limits + cascade async

- **Per-org AI daily cost cap.** `org_ai_quota_daily_usd` (default $5 trial, $25 paid). Block at 80%, warn at 50%. Slack alert per-org daily AI spend > $X. (Sandeep §3, Theo §6) 2 days.
- **Per-org rate limit on `/api/ai*`.** `keyGenerator: req.organization?.id || req.auth?.userId || req.ip`. (Ines §5) 0.5 day.
- **Cascade quality-check → async sample 10%.** Reclaims ~600ms p95 across SIMPLE-tier surface. (Mateo §3, Theo §4) 1 day.
- **Pax executive tool-loop streaming.** SSE between tool calls. Biggest TTFT win. (Mateo §3) 1.5 days.
- **AI cost dashboard.** Aggregate `aiTelemetryEvents` org × feature × day → tokens/cost cents/count/p95 latency. Slack daily 9am. 1 day.

### Week 10 — Stripe Tax + dunning channel + customer concentration

- **Stripe Tax + tax_id_collection + automatic_payment_methods.** Multi-state nexus solved + Apple Pay surfaces. (Hana §2, Vikram §2) 1 day.
- **Pin Stripe `apiVersion: '2024-11-20.acacia'`.** Add `payment_intent.requires_action` + `setup_intent.*` handlers. 0.5 day.
- **Dunning SMS leg + in-app banner.** Email-only today. (Marisol §2, Olu §4) 2 days.
- **Customer concentration alert.** >15% single-customer = alert; >25% = hard alert on `/founder-home`. (Marisol §3+§5) 1 day.
- **Subscription event ledger + deferred-revenue table.** Immutable `subscription_history` (Marisol §7); `deferred_revenue` table per Hassiba §2. Recognition worker. 4 days.

### Week 11 — DSAR pipeline + sub-processor DPAs + audit log fan-out

- **DSAR pipeline (real one).** Public intake form (no auth required), magic-link verification, multi-tenant fan-out lookup across `leads.email`, `properties.owner_email`, `borrowers.email`, `signers.email`, `inbox_messages.from_email`, `signatures.signer_email`. (Anouk §2) 4 days.
- **Sub-processor DPAs counter-signed.** 12 vendors. (Anouk §3, Greta) Ongoing — start outreach week 11; close all by week 18.
- **Audit-log fan-out.** Login (in `hydrateUser`), team-role change, founder-admin mutation, document signed, mailer dispatched, permission denied. (Sam §4) 2 days.
- **Lock down `audit_log` writes.** `REVOKE UPDATE, DELETE ON audit_log FROM acreos_app`; create `acreos_dba` role for compliance access. (Sam §4) 0.5 day.
- **`/api/privacy/data-export` + `/api/privacy/data-delete` endpoints.** Per Sam §7. 2 days.

### Week 12 — Optimistic mutations + skeleton choreography + IA cross-page

- **Optimistic-update sweep on top-5 verbs.** Kanban stage drag, task complete, lead status change, comment post, message send. Biggest perceived-latency win. (Bavo §2, Priya §2) 5 days.
- **`<ContentReveal>` pattern across `/today`, `/leads`, `/properties`, `/deals`, `/inbox`.** Same `staggerItem` wraps skeleton AND content; shape-matched. (Bavo §6) 3 days.
- **`layoutId` cross-page handoff: parcel-card → /parcels/:id hero.** First Apple-stock-tier interaction. (Lukas §3 S1, Kade §3 #9) Remove `<PageWrapper>` from `App.tsx:928-946` first. 2 days.

### Week 13 — Founder-bottleneck mitigations (Olu §7)

- **8 missing runbooks.** Clerk outage, Cloudflare outage, SES deliverability, Twilio 10DLC, e-sign stuck, GDPR delete, agent-misfire, founder-unavailable. (Olu §3, Beata §2) 1 day.
- **Vendor-status tile on `/founder-home`.** Pulls from existing `externalStatusMonitor.ts`. (Olu §7 #2) 0.5 day.
- **P0/P1 escalation buddy + ack-timer (30 min → SMS).** (Olu §7 #3) 0.5 day.
- **GDPR + org-merge admin UIs.** Wrappers around `gdprService` and `storage.mergeLeads`. (Olu §7 #4) 2 days.
- **Customer-context sidebar in `/admin/support` + saved-replies dropdown.** Cuts case-handling time roughly in half. (Olu §7 #5+#6, Kunle §2) 1.5 days.
- **Synthetic checks (15-min cron): test email through SES + test SMS through Twilio + Stripe webhook fixture.** (Olu §7 #7) 1 day.
- **Sophie human-in-loop guard for {refund, account_deletion, contract_terms, data_export}.** Force decisions inbox at any confidence. (Olu §7 #8) 0.5 day.

### Week 14 — RBAC repair + activation telemetry + retention infra

- **RBAC repair (Liana §1+§3).** Either implement real role distinction (acquisitions/marketing/finance) or collapse to four pragmatic roles. Honor `viewOnlyAssignedLeads` flag in `routes-leads.ts:73`. Make `getOrCreateOrg` re-check `isActive`. (Liana §3, Vincent §1) 2 days.
- **Activation telemetry.** Wire `lib/telemetry.ts` events through `onboarding-v2`, both checklists, `ProductTour`. Define `activation_events` table. (Yuna §8) 3 days.
- **Retention infra v0.** `retention_events`, `cohort_assignments`, `churn_reasons` tables. `/api/founder/cohort-retention?metric=user|revenue&days=7,30,90,365`. (Konstantin §2) 3 days.

**Acceptance for week 7-14:** 100-customer tipping-point checks (Elliot §2) all green; founder-time ceiling moved from 35 to 60 customers; AI cost ceiling moved from 60 to 200 customers; first DPA round-up complete.

---

## §4. The 90-day brand-and-narrative push (Week 15-26)

**Goal:** Brand belief locks onto specific customer + specific worldview. Voice is one person. Visual system at majority adoption. Lifecycle program covers pre-trial through win-back.

### Week 15-16 — Visual + design-system propagation

- **Codemod hardcoded Tailwind color literals → `acr-*` tokens** (Calla §7). 1,844 hits across JSX. Lint rule: `text-(green\|red\|amber\|yellow)-[0-9]+` is CI fail outside `components/ui/`. 1 week.
- **Build `<StatusBadge>` (consume `<StatusDot>`).** Codemod 4 local `getStatusColor` functions + 30 ad-hoc badges. (Calla §5) 1 day.
- **Verb canon `lib/labels.ts`.** Codify `Save changes / Update / Apply / Submit / Confirm / Discard / New / Add / Create / Delete / Remove`. Codemod ~120 buttons. (Calla §3) 2 days.
- **Page-header + heading-discipline propagation.** `<PageHeader>` from 12 → 50+ pages. Add `.acr-h1`, `.acr-h2`, `.acr-eyebrow` utilities. (Calla §6, Renske §6) 1 week.

### Week 17-18 — Lifecycle + retention program

- **14-message lifecycle program shipped end-to-end.** Welcome / re-entry / morning briefing / D7 cohort milestone / D30 NPS / pre-churn ladder / win-back T+0/T+2/T+7/T+30/T+90 / monthly newsletter / power-user / weekly-active digest. (Sigrid §3, Camila §4) 2 weeks.
- **Activation cohort dashboard + churn-reason taxonomy + `cancellation_reasons` ledger.** 1 week.

### Week 19-20 — Spotlight (⌘K) v2

- **Server-side fuzzy search (`pg_trgm` similarity).** Replace in-memory `.filter().includes()` at `command-palette.tsx:581`. (Anya §8) 1 day.
- **Matcher upgrade.** Bigram + acronym + substring. Recency × frequency LRU. (Anya §3.2) 0.5 day.
- **Verb expansion 6 → ~30.** `verbs.ts` registry. Each verb declares: keywords, args, preview, executor. (Anya §3.4) 1 day.
- **Pax inline preview + entity-resolution + scope filters (`in:leads`, `is:overdue`, `>$50k`).** (Anya §4) 2 days.
- **Delete `/pax`, `/ai`, `/agents`, `/ai-team` routes (60-day redirect).** Conversation history → rail's history tab. Move Insights to `/today` cards. (Holm §7, Anya §7) 1 day.
- **Discoverability: ⌘K topbar always visible on mobile; promote first-run toast from DEV to prod; "?" key opens shortcuts modal.** (Vesna P2-14, Anya §6) 0.5 day.

### Week 21-22 — Eval depth + prompt versioning + AI safety

- **Compliance disclosure post-validator.** Required state-specific sections present. Block delivery if missing. Move model to Opus 4.6 + extended thinking. (Theo §8 #7, Sayuri §2.3) 2 days.
- **80-conversation Pax executive eval set.** Tool-call eval. Single + multi-turn. PR-blocking on banned-phrase + persona-leak. 3 days.
- **Indirect-prompt-injection guard.** Apply `sanitizePrompt` to DB-sourced inbox/lead/property fields before interpolation. Sandbox with deterministic delimiters + "data not instructions" rule. Post-validators. (Nadia-AI §2.A) 2 days.
- **Prompt versioning + A/B harness.** Prompt changes ship as `pax_v3` shadow → production after eval pass. 2 days.

### Week 23-26 — Founder dashboard rebuild + accessibility full pass + SEO substance

- **`/founder-home` rebuild as CEO daily window.** One paragraph: cohort metric + autonomy delta + one-thing-broke + one-thing-surprised. Founder-internal telemetry lives a click deeper. (Asher §8) 1 week.
- **WCAG 2.2 AA full pass.** 55-site aria-label sweep; ChartPalette component using `--acr-chart-*` tokens; per-route `useDocumentTitle`; SC 2.4.11 focus-not-obscured fix; growth on dense compact rails to 24×24. (Devereux §6, Reuben) 2 weeks.
- **SEO substance.** Per-page OG image; canonical link; per-page JSON-LD (FAQPage, Product, Offer, Article); SSR/prerender for marketing routes; MDN-tier content corpus on `/help/glossary` (APN, comp, motivation, etc.); 6 comparison pages (vs Pebble, vs PropStream). (Dilan §3) 2 weeks.

**Acceptance for week 15-26:** primitives at >80% adoption; voice scorecard at 45/50; 14-message lifecycle program live; ⌘K is the spine; WCAG AA clean; organic search reachable for "land investing CRM," "tax-delinquent software," "seller financing portfolio."

---

## §5. The 6-month roadmap (Week 27-52)

### Vertical: Note Investor (Q4 2026)

- **`acquired_notes` data model.** Distinct path from "I sold my parcel and carried paper." (Linnea §1) 4 weeks.
- **BPO + tape diligence workflow.** Cash-on-cash yield, YTM at three discount prices, payment-history scoring on import. 3 weeks.
- **1098-INT batch generator.** January-only existential feature. Form 1096 transmittal. TIN capture. Box 2 (outstanding principal as of Jan 1) — requires year-boundary snapshot in schema. (Linnea §1, Wendell §4, Zerah §2) 4 weeks.
- **Note assignment paperwork.** Allonge + Assignment of Mortgage/Deed of Trust. (Linnea §1) 2 weeks.
- **Sophie agent expansion.** From half-trained read-only to full mode. (Ana §6) 4 weeks.
- **Note-investor onboarding flow + `pax_tour` step rewrite.** (Yuna §5) 1 week.

**Note-investor wedge target: Q1 2027 (week ~52). $300M TAM at $500/mo all-in (Ashok §2.2).**

### Team-size readiness (concurrent with Note vertical)

- **Per-seat pricing + admin-controlled provisioning.** Solo $249 / Operator (3 seats included, +$99/seat) $499 / Operation (10 seats, +$129/seat) $1,290 / Enterprise (custom, SSO line item, audit log, CSM). (Penelope §1+§4, Tegan §3) 1 week.
- **Round-robin lead assignment.** Per-rep workload balance. (Penelope §1) 2 weeks.
- **Manager dashboard with real per-rep data.** Pipeline filtered by `assigned_to`; daily activity rollup; commission tracking; bid comparison. (Penelope §1+§3, Vincent) 3 weeks.
- **Slack/Teams integration.** Webhook out to channel; "send this lead to #acquisitions-pod"; `@mention` notifications. (Penelope §1) 2 weeks.
- **Per-record owner enforcement + approval workflow on offers.** (Vincent §1, Penelope) 2 weeks.

**Team-of-3 (Vincent) ship target: Q4 2026 (week ~38).**
**Team-of-10 (Penelope) ship target: Q1 2027 (week ~50).**

### Accessibility full pass (concurrent)

- Coverage of every route + chart palette + focus management. (Devereux §6, Reuben) 4 weeks ongoing.

---

## §6. The 12-month roadmap

What AcreOS looks like at week 52 if every sprint above ships:

- **Land Investor wedge: $10M ARR.** ~2,500 paying customers at $400/mo blended ARPU. Defensible.
- **Note Investor live as second product.** 500 customers. $300/mo blended. Sophie full agent.
- **Tax-Delinquent vertical scoping.** Marcus's 5-state-rules table real; auction calendars wired to county data via partnerships.
- **Wholesale: NOT YET.** Defer to month 18 (Asher closing, Linnea, Trey, Brigid all align).
- **Brand: locked.** Voice is one person across every surface. Persona architecture is enforced at lint, not vibes. ⌘K is the spine. Pax is a verb that lives in two shells (⌘K + rail), not seven.
- **Compliance: SOC 2 Type 1 in flight.** Functional MFA (Clerk native), full audit-log coverage, sub-processor DPAs counter-signed, IR runbook + 1 tabletop exercise per quarter, data-deletion + export endpoints production-grade, content-hash on signed documents, completion certificates generated.
- **Series-A: $12M at $60M post.** Ashok §1: contingent on (a) tier truth + event ledger + Stripe Tax (week 1-10 — done), (b) compliance posture (week 17-22 — in flight), (c) NRR decomposition + customer-concentration view (week 10 — done), (d) 10% MoM growth at $5M ARR. The 4 things Ashok §7 listed are checked off by week 24.
- **Team: Thomas + 4 engineers + 1 ops/CS.** No earlier; no later.
- **Multi-region: NOT YET.** Tripwires per Salma §1; `iad` correct until then.
- **Family-office, Capital-markets, Wholesale, Imelda-grade Landlord: P3 (NOT YET).** Defer past month 12.

---

## §7. What to NOT do (the explicit out-of-scope list)

This list exists because every persona who flagged these is unanimous: doing them now is a strategic distraction.

| # | Don't | Why | Who flagged it |
|---|---|---|---|
| 1 | **Don't build family-office multi-entity (`entity_groups`)** | Theodora explicitly: "I would not adopt AcreOS at any price" — 6-9 months engineering for an audience that won't move the needle. The `parent_organization_id` exists for white-label reseller; leave it. | Theodora |
| 2 | **Don't build true capital-markets (PPM, waterfall, Form D, accreditation, tranching)** | Otto: "the underlying data AcreOS sits on, if it actually scales the originator side, is genuinely interesting" — but **as data feed for Bloomberg-of-seller-financed-paper, not as fake securitization engine.** Position upstream; defer downstream tooling. | Otto §1+§2 |
| 3 | **Don't reach for Customer.io / Iterable / Braze before 1,000 customers** | Markdown templates + own `emailService` + transport (SendGrid/Postmark) is enough. Sigrid §3 + Camila both: ship the 14-message program first; lifecycle gap is content + transport, not platform. | Sigrid, Camila |
| 4 | **Don't ship Wholesale, Tenant CRM, or full Subdivision before Land hits $10M ARR** | Linnea + Trey + Brigid + Imelda all said: renaming a column isn't a data model. Each is a 1-3 quarter build. Note-Investor next (Sophie already half-trained); Tax-Delinquent third; Wholesale = 36-month decision. | Linnea, Trey, Brigid, Imelda, Marcus, Ana, Asher |
| 5 | **Don't add a 5th theme; don't ship a "Landlord" persona slot** | The persona-architecture trap is "almost every persona" — build for one until that one wins. Imelda flagged "20% built; almost a separate product." | Imelda, Wendell |
| 6 | **Don't build a "real estate attorney"-grade purchase-contract layer in-house** | Whitman §2: integrate doc-prep service (Smokeball, Texas Title Forms, FAR/BAR vendor) instead. State-by-state attorney review of a generated contract is a 10-attorney problem. | Whitman §2 |
| 7 | **Don't ship audio sound effects at launch** | Sven §4: "AcreOS hasn't earned the right to make sound yet." Brief §13 forbids visual confetti; the audio equivalent is forbidden by extension. Web-haptic vocab (4 events) instead. **Either ship 2 sounds carefully or rewrite the Settings copy that promises soft-clicks-and-a-chime.** | Sven §4 |
| 8 | **Don't run Product Hunt as the launch moment** | Greta §6: save the launch for the milestone that earns press coverage (10K users / $10M ARR / Note vertical opening). Product Hunt is a single-day spike that distracts from press readiness. | Greta |
| 9 | **Don't migrate to multi-region before the tripwires fire** | Salma §1: (a) Canadian/EU residency-clause customer, (b) one non-iad metro >150 paying orgs, (c) <99.95% SLA contract. None of these fire at 100 customers. | Salma §1 |
| 10 | **Don't hire a "support team" before fixing the L2 escalation gap** | Olu §1: the agent layer is genuinely above-bar. The gap is human-fallback for the *uncommon path*. One ops hire at customer ~30 + escalation buddy is the right shape. Not 4 support engineers. | Olu |
| 11 | **Don't enable real-time voice AI ($0.30/call) before adoption signals justify** | Sandeep + Mateo. Wild card line item; defer until product-market signal. | Sandeep, Mateo |
| 12 | **Don't ship `enable Atlas/Sophie/Forge in customer UI` even by accident** | This is the most-cited finding in the audit (10 personas flagged it). Brand belief = three named coworkers. Customers see Pax. Lint enforces. Period. | Asher, Vesna, Mira, Hiroko, Tomás, Theo, Yusuf, Joaquín, Eden, Ana |

---

## §8. Per-week sprint breakdown (first 90 days)

Assumes one engineer + Claude (per CLAUDE.md). Each week ships in canary first; 24-48hr soak before flag-flip.

| Week | Sprint | Deliverable | Owner |
|---|---|---|---|
| **1** | Tier truth + R1+R4 + Idempotency-Key wire | Single `shared/billing/tier-pricing.ts`; founder-check leak fixed; Clerk MFA migrated; client UUID per mutation in `apiRequest` | Thomas + 1 eng |
| **2** | E-sign idempotency + Twilio replay + F1+F2 + encryption consolidation | E-sign row lock; Twilio MessageSid unique; SSRF guard; SendGrid event webhook; invite-token hash | 1 eng |
| **3** | Pricing decision + microcopy sweep + founder letter discoverability | Operator-class tiers live; voice `docs/voice.md`; `/security` page; curated `/changelog`; cancellation flow | Thomas + design + 1 eng |
| **4** | Settings 17→7 + duplicate-route redirects + empty-state archetypes | 7 settings tabs; 6 redirects; 3 archetypes shipped; `<FirstDayHero>` for `/today` zero-data | 1 eng |
| **5** | Eval harness v0 + AI bypass migration + deprecated-model kill + Pax v2 | 50-prompt golden set; 10 services migrated; `gpt-4-turbo-preview` removed; Pax exec prompt rewritten + cached | 1 eng |
| **6** | Sentry hygiene + content hash + ESIGN element 4+5 closure | `release` tag + setUser; web-vitals; replay PII mask; `documentContentHash` + signed-PDF archive; NY-state block | 1 eng |
| **7** | pgBouncer + Postgres extensions + index audit | App-side pool 5; pg_stat_statements live; 13 indexes added | 1 eng |
| **8** | Background jobs migration to setTimeout + DLQ | 6 P0 jobs self-rescheduling; outbox table; per-job timeout | 1 eng |
| **9** | AI cost ceiling + per-org rate limit + cascade async + tool-loop streaming | `org_ai_quota_daily_usd`; per-feature p95/cost dashboard; SSE Pax exec | 1 eng |
| **10** | Stripe Tax + Stripe pinning + dunning SMS + customer concentration + ledger + deferred revenue | `automatic_tax: enabled`; apiVersion pinned; SMS dunning; concentration alert; `subscription_history` + `deferred_revenue` tables | 1 eng |
| **11** | DSAR pipeline + DPA outreach + audit log fan-out + audit lockdown | Public DSAR intake → fan-out; audit-log fan-out covers logins/role-changes/founder-admin/sign/dispatch/denials; `REVOKE UPDATE,DELETE` | 1 eng |
| **12** | Optimistic mutations + skeleton choreography + layoutId hero handoff | 5 verbs optimistic; `<ContentReveal>` on 5 surfaces; parcel-card → /parcels/:id morph | 1 eng |
| **13** | Founder-bottleneck mitigations | 8 missing runbooks; vendor-status tile; escalation buddy; GDPR/org-merge UI; customer-context sidebar; saved-replies; synthetic checks; Sophie HIL guard | 1 eng + Thomas |
| **14** | RBAC repair + activation telemetry + retention infra | 4 pragmatic roles; `viewOnlyAssignedLeads` honored; `activation_events`/`retention_events`/`cohort_assignments`/`churn_reasons` tables | 1 eng |
| **15-16** | Visual primitives propagation | acr-* token codemod (1,844 hits); `<StatusBadge>`; verb canon; PageHeader propagation | 1 eng |
| **17-18** | 14-message lifecycle program | Welcome / re-entry / morning-briefing / D7 / D30-NPS / pre-churn ladder / win-back / newsletter / power-user | 1 eng + design |
| **19-20** | ⌘K v2 + delete `/pax` route | Server-side `pg_trgm`; matcher upgrade; verb expansion; Pax inline preview; rail-as-only-Pax-page | 1 eng |
| **21-22** | Eval depth + compliance post-validator + injection guard + prompt versioning | 80-conversation Pax exec eval; compliance Opus + post-validator; sanitize DB-sourced; `pax_v3` shadow harness | 1 eng |
| **23-26** | `/founder-home` rebuild + WCAG AA full pass + SEO substance | CEO daily window; 55-site aria; ChartPalette; per-route titles; per-page OG/JSON-LD; SSR marketing routes; MDN-tier glossary | 1 eng + design |

**Total cost estimate at one engineer + Claude per week: ~26 weeks, with ~30% buffer for surprises = 6 calendar months. Two engineers parallelize most of weeks 7-26 to ~16 weeks.**

---

## §9. Success metrics (how we know each sprint shipped)

| Sprint | Pass criterion |
|---|---|
| Week 1-2 (launch readiness) | All 12 P0 in `_MASTER-FINDINGS.md` §1 closed; ESLint guard live; canary blue; zero double-charges in soak. |
| Week 3-6 (quality sprint) | Voice scorecard from 32/50 → 40/50 (Mira §8); empty-state coverage 35 ad-hoc → 0; `/settings` 17 → 7 tabs; eval gate blocks PR drops > 5%. |
| Week 7-14 (scale prep) | Elliot §2 100-customer tipping-point checks all green; AI cost at 100 customers projected from $24K/mo → $10K/mo (60% recoverable per Sandeep §2); founder-time per week (Olu) projected ≤ 15 hrs at 50 customers. |
| Week 15-26 (brand push) | `acr-*` token adoption ≥80%; lifecycle program live (12 of 14 messages firing); ⌘K is the spine (Holm §7 + Anya §1 verdict); WCAG AA clean across customer surfaces. |
| 6-month (vertical + team) | Note Investor wedge: 50 paying note customers; Sophie agent at full mode; Team-of-3 product live (Vincent's 5 questions answered yes); team-of-10 product in canary. |
| 12-month | $10M ARR Land + $1.5M ARR Note; Series-A IC memo (Ashok §1) clears all 4 gating items; SOC 2 Type 1 audit kicked off; brand voice = one person across every surface. |

---

*— Master action plan · 2026-05-01 · cohering 86 audits · directly executable per CLAUDE.md (one engineer + Claude pair).*
