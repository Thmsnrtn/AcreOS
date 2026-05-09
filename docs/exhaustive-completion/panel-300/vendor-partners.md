# 17. Vendor Partners (slots 241–255)

**Core tension each persona navigates:** adoption metrics vs account health. Stripe wants Connect adoption (earn fee-sharing revenue). Clerk wants auth-flow conversion benchmarks. AWS wants cost-optimization recommendations. Twilio wants 10DLC adoption. These 15 personas answer: *What AcreOS surface would unlock our mutual success metrics, and how do we measure it?*

---

## 241. Stripe Partner Manager

**Lens:** Connect + Tax adoption; fee-sharing revenue expansion. Stripe account team. Obsessed with "how many AcreOS orgs use Stripe Connect for payout automation?"

**State read:** AcreOS integrates Stripe for subscription billing. No Stripe Connect (marketplace payout). No Stripe Tax adoption. Revenue: $0 in Stripe revenue-share.

**Highest-leverage move:** Stripe Connect for contractor payouts: AcreOS operators manage contractor draw-schedules via AcreOS; on approval, Stripe Connect automatically wires contractor (no manual ACH). Enable Stripe Tax (sales-tax on fix-and-flip invoice items). Measure: Connect adoption % of orgs (target: 30% by 2026-Q3), Tax API monthly calls (target: 10K by EOY). Effort: 4 weeks (Connect onboarding + tax API wiring).

**Biggest risk:** Contractors don't trust Stripe payouts; demand manual ACH; AcreOS team builds custom reconciliation; Connect adoption stalls.

---

## 242. Clerk DX Lead

**Lens:** Auth-flow conversion benchmarks; MFA adoption. Clerk account team. Obsessed with "what's AcreOS's Day-7 MFA adoption rate and how can we improve it?"

**State read:** AcreOS uses Clerk (P0-4 shipped Clerk-native MFA). No MFA-adoption telemetry. No onboarding variant testing. Current guess: 15% MFA adoption by Day 7.

**Highest-leverage move:** Onboarding A/B test: variant A (current) vs variant B (MFA prompt at signup, not Day 7). Measure: Day-7 adoption, Day-30 churn, account-security incidents. Ship telemetry to Clerk (w/PII-scrub) so Clerk can benchmark AcreOS vs Clerk customer cohort. Effort: 2 weeks (telemetry + A/B experiment).

**Biggest risk:** MFA adoption increases but churn also increases (Day-7 adoption friction); net KPI is negative.

---

## 243. AWS Solutions Architect

**Lens:** Cost-optimization recommendations; architecture accountability. Account team. Obsessed with "how much is AcreOS paying for RDS, S3, Lambdas annually?"

**State read:** AcreOS runs on Fly.io (not AWS). AWS has no cost-visibility. Potential AWS TAM: $100K+/yr (RDS, S3, Lambda, SageMaker for AI).

**Highest-leverage move:** AWS cost-analysis + migration plan: if AcreOS were to move to AWS (conditional exploration), estimated savings = 15–25% on compute via RDS Reserved Instances, S3 storage classes, Lambda concurrency optimization. Detailed ROM (rough order of magnitude) for migration. Decision: stay on Fly.io (simpler ops) or move to AWS (cost + feature depth). Effort: 1 week (ROM build).

**Biggest risk:** AWS charges AcreOS for exploring migration; ROI is negative if migration doesn't happen.

---

## 244. Twilio CSM

**Lens:** 10DLC + carrier-relationship tier advancement. Twilio account team. Obsessed with "why is AcreOS still on shared short codes? Can we upgrade to 10DLC + dedicated carrier?"

**State read:** AcreOS sends SMS via Twilio shared short code (~50 msgs/sec limit). No 10DLC (10-digit long code). No dedicated carrier relationship. Message-delivery unpredictable (high filtering on some carriers). 

**Highest-leverage move:** 10DLC pilot: AcreOS applies for 10DLC code (brand vetting required). SMS workflows (reminder, alert, confirmation) reroute from short code → 10DLC. Measure: delivery rate (target: 98%+), carrier filtering reduction (target: <2%). If successful, commit to dedicated carrier relationship + SLA. Effort: 3 weeks (brand vetting + route migration).

**Biggest risk:** 10DLC application rejected (brand fail); SMS delivery continues degrading; AcreOS investors miss rent-collection reminders.

---

## 245. OpenAI Partnerships Lead

**Lens:** Model-deprecation playbook adoption; API-version pinning. OpenAI account team. Obsessed with "how prepared is AcreOS for GPT-5 release? Can they swap models without breaking production?"

**State read:** AcreOS uses GPT-4o for Pax draft generation. Hard-pinned to `gpt-4o-2024-11-20`. No feature-flag for model swap. No model-deprecation runbook. Upgrade = code change + deploy.

**Highest-leverage move:** Model-swappability framework: AcreOS uses feature flags (`PRIM_MODEL`) to control model version per feature (Pax draft = `gpt-4o`, compliance-AI = `gpt-4o`, etc.). New model release: flip flag, canary 10% of traffic, measure quality (hallucination eval), roll out to 100% if eval passes. Document playbook in `docs/runbooks/model-swap.md`. Effort: 2 weeks (feature-flag wiring + eval integration).

**Biggest risk:** GPT-4o becomes slow / expensive; AcreOS can't swap to Claude without major code rewrite; stuck on old model.

---

## 246. Anthropic Partnerships Lead

**Lens:** Safety-eval adoption; post-validator integration. Anthropic account team. Obsessed with "does AcreOS run deterministic post-checks on Claude outputs for compliance-AI use cases?"

**State read:** AcreOS uses Claude (Opus 4.5, Haiku for small tasks) for Pax draft + compliance-AI disclosure generation. No deterministic post-check. No eval corpus per persona. P0-3 + P1-38 cite post-validator need but not fully implemented.

**Highest-leverage move:** Post-validator framework: compliance-AI disclosure generation runs Opus → post-validator checks (a) no legal liability statements, (b) statutory disclosure format compliant, (c) no hallucinated tenant-screening scores. Fail = return to Opus with error message. Eval corpus: 50 test cases per persona (land investor, BH operator, wholesaler) with expected disclosure shape. Run monthly. Measure: pass-rate (target: 99%+). Effort: 3 weeks.

**Biggest risk:** Post-validator is too strict; usable disclosures rejected; Pax productivity drops.

---

## 247. Lob Partner Manager

**Lens:** Print-vendor SLA; mail-delivery quality. Lob account team. Obsessed with "what's AcreOS's monthly mail volume and delivery SLA?"

**State read:** AcreOS uses Lob for yellow-letter mailers. ~500 mailers/month (estimated). No volume commitment. No SLA. Monthly deliverability = unknown (no feedback loop from USPS).

**Highest-leverage move:** Mailer-feedback loop: Lob returns delivery status (delivered, returned, undeliverable) → AcreOS tracks by operator + geography. Dashboard: "yellow letters delivered this month: 487, returned: 13, bounces: 0." Commit to 1,000+ monthly mailers by EOY (scaling incentive). Negotiate tiered SLA: 97% delivery, 24h turnaround. Effort: 2 weeks (status-ingestion + tracking UI).

**Biggest risk:** Mailers have high return rate (bad addresses); AcreOS reputation suffers; investors switch to competing mailer.

---

## 248. Cloudflare Partner Engineer

**Lens:** WAF rule customization; edge-compute adoption. Cloudflare account team. Obsessed with "how much can we protect AcreOS from DDoS, bot traffic, and form-spam using WAF + Workers?"

**State read:** AcreOS uses Fly.io + Cloudflare nameserver (basic). No WAF rules. No custom Workers. Exposed to form spam, suspicious login patterns.

**Highest-leverage move:** WAF + Workers deployment: Cloudflare WAF blocks (a) form-spam patterns (honeypot fields, bulk submissions), (b) suspicious login patterns (failed attempts > 10/min per IP), (c) DDoS-like patterns (request rate > 100 req/sec from single IP). Custom Worker on `/api/*` routes: rate-limit + geo-blocking (for now: US-only, log non-US access). Measure: blocked requests/month, false-positive rate (target: <1%). Effort: 3 weeks.

**Biggest risk:** WAF is too aggressive; legit users get blocked; support tickets surge.

---

## 249. Sentry Customer Success

**Lens:** PII-scrubbing rule coverage; error-budget tracking. Sentry account team. Obsessed with "how thorough is AcreOS's PII scrubbing? Are we accidentally logging borrower SSNs?"

**State read:** AcreOS ships Sentry error reporting. PII scrubbing rules implemented (P0-5, P0-8 cite scrubbing). No periodic audit. No error-budget tracking (SLA target: 99.5% uptime). Error-log volume: ~2,000 errors/month (unknown severity distribution).

**Highest-leverage move:** PII-audit + error-budget SLA: quarterly audit of Sentry logs for PII escapes (regex patterns for SSN, TIN, credit card). Error-budget dashboard: uptime % vs SLA target (alert if trending below 99.5%). Auto-segment errors by severity (P0 = production incident, P1 = feature broken, P2 = degradation). Measure: zero PII leaks/quarter, maintain 99.5%+ uptime. Effort: 2 weeks.

**Biggest risk:** Audit finds SSN in error logs; remediation + notification overhead; customer goodwill damage.

---

## 250. Fly.io Support Engineer

**Lens:** Machine-failover playbook; regional-failover adoption. Fly.io support team. Obsessed with "how prepared is AcreOS for machine failure or region outage?"

**State read:** AcreOS runs on Fly.io 3 regions (US). No failover playbook. No cross-region replication. Outage duration: ~30 minutes (manual intervention to restart).

**Highest-leverage move:** Active-active failover: replicate DB across 3 Fly regions (managed by Fly + Supabase). App instances in all 3 regions. DNS failover (Cloudflare) on health check (30s interval). Document runbook: `docs/runbooks/10-regional-failover.md`. Measure: failover automation (manual intervention → automatic), RTO (target: <2 minutes), RPO (target: zero data loss). Effort: 4 weeks (Supabase geo-replication + Cloudflare DNS automation).

**Biggest risk:** Failover is untested; fails during real outage; RTO extends to 2+ hours.

---

## 251. Dropbox Sign Partner

**Lens:** Idempotency-pattern adoption; webhook reliability. Dropbox Sign account team. Obsessed with "does AcreOS handle Dropbox Sign webhooks idempotently? Are we sending duplicate signing requests?"

**State read:** AcreOS uses Dropbox Sign for e-signature. P0-10 flagged idempotency gap (webhook doesn't claim atomically). Duplicate sends: unknown (no telemetry). Retries: customer-side (no backoff, causes cascading failures).

**Highest-leverage move:** Idempotency v2: implement at Dropbox Sign level (if supported) + AcreOS level (idempotency-key on request, atomic claim on webhook). Document webhook-handler best practices in `docs/integrations/dropbox-sign.md`. Measure: duplicate-send rate (target: zero), webhook-error rate (target: <0.5%). Effort: 1.5 weeks (already partially done in P0-10, just needs Dropbox Sign side validation).

**Biggest risk:** Duplicate signing requests sent; investors sign twice; title company rejects as suspicious.

---

## 252. Plaid Partner Manager

**Lens:** Consent-renewal cadence; data-access freshness. Plaid account team. Obsessed with "how often do AcreOS orgs re-consent to bank-data access? Do we have stale consents?"

**State read:** AcreOS uses Plaid for bank-feed optional enrichment (future). No orgs using it yet. No consent-renewal strategy.

**Highest-leverage move:** Consent-renewal framework: if bank-feed integration ships, Plaid consents auto-expire every 12 months (per Plaid's policy). AcreOS auto-prompts user "re-authenticate your bank account" at month-11 (prevent data stale-out). Track: consent-renewal rate (target: 80%+ re-consent within 30d of expiry), data-feed uptime (target: 98%+). Effort: 2 weeks (ready for when bank-feed feature ships).

**Biggest risk:** Consent expires; bank data goes stale; investor doesn't realize cash-position is 60 days old.

---

## 253. Mapbox / Google Maps account exec

**Lens:** Quota-tier tuning; map-API efficiency. Mapbox or Google Maps account team. Obsessed with "what's AcreOS's monthly map-tile request volume and where are we inefficient?"

**State read:** AcreOS uses Regrid (parcel data) + Mapbox (map rendering). Monthly tile requests: ~5M (estimated). No quota-optimization. No batch requests for property-list renders.

**Highest-leverage move:** Map-quota optimization: implement tile-layer batching (render 10 properties at once instead of 10 individual requests). Cache parcel tiles (24h TTL). Monitor tile-request pattern (spike at property-list load = inefficient). Target: reduce monthly requests from ~5M to ~2M (60% reduction = $400/month savings). Measure: request volume, cost/tile, map-render latency. Effort: 2 weeks.

**Biggest risk:** Optimization breaks clustering; properties don't display; investors see blank map.

---

## 254. Regrid Customer Success

**Lens:** API-rate-limit fit; data-currency SLA. Regrid account team. Obsessed with "is AcreOS's API-rate limit sufficient? Are we throttling?"

**State read:** AcreOS pulls parcel data from Regrid daily (batch). Rate limit: 50 req/sec. Current usage: ~30 req/sec peak (60% utilization). No SLA for data currency (daily batch = 24h max staleness).

**Highest-leverage move:** Real-time parcel-update subscribe: if Regrid supports webhooks or push-feeds, AcreOS subscribes to real-time parcel updates (purchase, tax assessment, lien) instead of daily batch. Measure: data staleness (current: 24h, target: 2h), API rate-limit headroom (target: stay <70% utilization). Effort: 2 weeks (if Regrid supports push; otherwise, increase batch cadence to 4x/day).

**Biggest risk:** Real-time feed has higher latency than batch; data accuracy issues; investor sees stale parcel value.

---

## 255. Snyk / FOSSA license auditor

**Lens:** Copy-left detection; open-source compliance. License-compliance auditor. Obsessed with "does AcreOS have any GPL/AGPL dependencies that create license liability?"

**State read:** AcreOS has 200+ npm dependencies. No license-scanning automation. Unknown if copy-left deps are present.

**Highest-leverage move:** License-audit automation: integrate Snyk or FOSSA into CI/CD. Fail build on GPL/AGPL/SSPL detection (or flag for legal review). Monthly audit report: dep summary, risk tier (green = permissive, yellow = weaker copyleft, red = strong copyleft requiring disclosure). Measure: zero high-risk deps, 100% of deps classified. Effort: 1 week (CI integration + reporting).

**Biggest risk:** Undetected GPL dependency; AcreOS used in commercial product; GPL violation claim; legal exposure.

---

## 256. Category-level synthesis: Vendor Partners

**Top 5 recommendations clustered from the 15 memos:**

1. **Adoption telemetry + success-metrics dashboards (Stripe, Clerk, Lob, Sentry, Regrid)** — Five vendors all want "AcreOS operators are happy + metrics are improving." Build shared telemetry framework: adoption %, DAU, feature-usage, error rates, data-freshness. Effort: 3 weeks (telemetry engine + per-vendor dashboards).

2. **Model-swappability + post-validator framework (OpenAI, Anthropic)** — AI vendors need AcreOS to swap models + run deterministic checks without code changes. Feature-flag wiring + eval-corpus integration. Effort: 3 weeks.

3. **Integration best-practices playbooks (Dropbox Sign, Twilio, Plaid, Cloudflare)** — Document 5 integration patterns: idempotency, 10DLC adoption, consent-renewal, WAF ruleset. Effort: 2 weeks (documentation only).

4. **Compliance + reliability uplevels (Sentry, Lob, Fly.io)** — Error-budget SLA (99.5% uptime), PII-audit (zero leaks/quarter), mailer-feedback loop (97% delivery), failover automation (RTO <2 min). Effort: 6 weeks (4 small work-streams in parallel).

5. **Cost-optimization + quota-tuning (AWS, Mapbox, Regrid)** — Architecture ROM (AWS savings estimate), tile-request batching (60% reduction), real-time parcel updates (24h → 2h data staleness). Effort: 4 weeks (1-2 weeks each).

