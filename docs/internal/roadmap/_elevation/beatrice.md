# Beatrice — CRO Elevation Brief

**Author:** Beatrice Whitfield, Chief Risk Officer (compliance + legal + security + AI safety + privacy)
**Date:** 2026-06-07
**Lens:** Risk/trust elevation — security hardening depth, data-classification breadth, compliance polish, "tool not advisor" guardrails, audit-log maturity, defensibly-trustworthy-at-scale. Both customer and founder sides.

---

## Framing

We are in genuinely strong shape. The substrate I would have demanded for a Series-A diligence pack already exists pre-revenue: a tamper-evident SHA-256 audit hash chain with seal-on-purge (`server/utils/auditLogChain.ts`, `auditLogPurge.ts`), a column-grained data-classification registry with a lint that fails the build on undeclared PII (`shared/data-classification.ts`), a wired prompt-injection pre-filter + post-validator + per-user rate limiter (`sanitizePrompt.ts`, `validatePaxResponse.ts`, `injectionRateLimiter.ts`), a public DSAR intake with 24h SLA (`server/routes-privacy-dsar.ts`), append-only consent events (`server/services/consentEvents.ts`), a per-state disclosure registry that fails *closed* (`server/services/disclosureRegistry.ts`), field-level AES-256-GCM with a rotation script (`server/scripts/rotateEncryptionKey.ts`), customer-facing /security, /privacy, /legal/sub-processors trust pages, and alignment + compliance continuous-audit detectors that cite the constitution by immutable number (`server/services/pax/alignmentDetectors.ts`, `pax/continuousAudit.ts`).

So this brief is NOT a gap list. It is a *distinctiveness* list. The bar I am holding us to: when a sophisticated land investor (or their attorney, or an acquirer's diligence team, or a CFPB examiner) goes looking for the thing that proves we are serious, what do we want them to find — and what would make them flinch? Best-in-class trust is not the absence of risk; it is the *visible, legible discipline* around it.

---

## Top ideas (highest value first)

### 1. Put a standing AI-disclosure + "tool, not advisor" rail on the Pax surface itself
- **Kind:** refine · **Side:** both · **Effort:** S
- **Why it matters / what great looks like.** This is the one that would embarrass us. Our five-pillar doctrine's pillar #1 is "AcreOS is a tool, never an advisor," and customer immutable #7 is "always disclose AI use clearly." We enforce both *server-side* beautifully (the post-validator even cites immutable #7 when it catches a persona leak). But the primary conversational surface — `client/src/pages/pax.tsx` — has **zero standing customer-visible disclosure**: no "Pax surfaces data; you make the call," no "verify before acting," no persistent "AI-generated — may contain errors." We have `required-disclaimer.tsx` and `disclaimer-banner.tsx` components used in ~12 places (offer generator, DD panel) but NOT on the chat door everyone lives in. A great version: a quiet, always-present composer-footer line ("Pax surfaces public data and your own records to inform your decisions — it never decides for you. Verify before you act.") plus a one-time first-session interstitial. Legible, calm, not nagging. This closes the single largest gap between our *enforced* posture and our *disclosed* posture.
- **First step.** Add a `<PaxDisclosureRail/>` to `client/src/pages/pax.tsx` near the composer; source the copy from a single constant so the voice-linter and I can audit one string. Reuse `disclaimer-banner.tsx` styling tokens.

### 2. OFAC / sanctions screening on counterparties before money or documents move
- **Kind:** develop · **Side:** both · **Effort:** M
- **Why it matters / what great looks like.** My charter lists OFAC screening under security posture, and a repo grep finds *none* — the only "screening" hits are tenant credit screening and county batches. We facilitate seller-finance notes and document dispatch to named counterparties (`leads`, `financial_ledger.counterparty_name`). Transacting with an SDN-listed party is strict-liability under OFAC; "we're just software" is not a defense once we generate the note and move the dollars. Great looks like: a deterministic name-screen against the OFAC SDN + Consolidated lists (free, downloadable, refreshable) at two chokepoints — note/document signature-request dispatch and any financial_ledger entry tied to a counterparty — that *warns* (does not auto-block; tool-not-advisor) and writes an audit_log row with the match-score and list version. This is a genuine differentiator: no land-investor tool I know does counterparty sanctions hygiene.
- **First step.** New `server/services/sanctionsScreen.ts` (pure matcher + a cached list loader keyed by SDN file date); wire a soft check into the disclosure-gate path in `routes-doc-system.ts` alongside `checkDisclosure()`. Emit `audit_log` action `sanctions.screen`.

### 3. Ship the public Transparency Report — turn the dormant substrate into a flagship trust artifact
- **Kind:** elevate · **Side:** both · **Effort:** M
- **Why it matters / what great looks like.** `server/routes-transparency.ts` is a deliberate stub ("coming soon"); the full pipeline behind it is real — `pax_refusal_payloads`, `pax_decision_appeals`, `transparency_reports`, the nightly aggregator, demographic-bias + drift findings. We are sitting on a category-defining artifact and showing a placeholder. A published, periodically-stamped transparency report (refusal counts by immutable, appeals upheld/reversed, founder-bypass count, bias-review status) is the single most distinctive trust signal an AI-native company can carry into 2026 — and it's the natural home for EU-AI-Act / state-AI-law (CO SB24-205, TX TRAIGA, CA) posture as those bite. Great looks like: a clean public `/transparency` page rendering the latest published row, with a short plain-English methodology note and a "we publish even when the numbers are unflattering" stance.
- **First step.** Build the UI-only surface the stub was explicitly designed to enable — read the latest `transparency_reports` row server-side, render with the existing `PublishedTransparencyReportShape`. Pair with Quinn on the methodology copy.

### 4. Quarterly evidence-grade audit-chain verification + a "verify my history" customer affordance
- **Kind:** elevate · **Side:** both · **Effort:** S
- **Why it matters / what great looks like.** The hash chain is excellent but it is only as valuable as its *exercise*. Today `verifyAuditLogChain()` exists and there's a `/api/admin/audit-log/verify` endpoint — but nothing forces a scheduled walk, and the customer has no way to see that their own action history is tamper-evident. SOC 2 CC7.2/CC7.3 (which the file already cites) reward *operating effectiveness*, not just design. Great looks like: a scheduled job on the worker that walks every org's chain weekly, writes the verification result + Merkle-root tip to the audit ledger, and surfaces "Your activity log is tamper-evident — last verified <date>, chain intact" inside Settings → Security activity (`security-activity-log.tsx`). That sentence, shown to a customer, is worth more trust than the cryptography itself.
- **First step.** Add a `verifyAuditChains` job to `server/jobs/runScheduledJobs.ts`; persist the tip hash; add the one-line attestation to `security-activity-log.tsx`.

### 5. Broaden the data-classification registry from a "highest-risk register" to near-complete coverage, and use it to gate exports
- **Kind:** improve · **Side:** both · **Effort:** M
- **Why it matters / what great looks like.** The registry is deliberately a *risk register* (highest-risk tables only) and defaults unknown columns to `internal`. That was the right v1. But the breadth gap is now the weak link: a new feature can add a `borrower_dob` or `bank_account_last4` to a table I haven't enumerated, and as long as it dodges the name heuristic it ships as `internal` and could flow into a DSAR export or customer audit metadata unscrubbed. Great looks like: registry coverage of every table that holds counterparty/borrower/financial data, the GDPR export path (`gdprService.exportUserData`) routed through `redactByClassification` with an explicit per-class export policy, and a `data-flow map` doc generated *from* the registry (which classes leave which trust boundary) — the artifact an acquirer's privacy reviewer asks for on day one.
- **First step.** Extend `CLASSIFICATION_REGISTRY` to cover the notes/deals/documents/parcel tables; add a test that asserts every `sensitive_financial`/`pii` column is either redacted or explicitly allow-listed in the DSAR export builder.

### 6. A versioned, machine-checkable disclaimer/disclosure registry — one source of truth for every "not advice" string
- **Kind:** improve · **Side:** both · **Effort:** S
- **Why it matters / what great looks like.** Right now the "informational only / verify / not your attorney" language lives in many places: `complianceValidator.ts`, `usury.ts`, `propertyReportPdf.ts`, `required-disclaimer.tsx`, `disclaimer-banner.tsx`, `taxOptimizer.ts`, the RMLO advisor, the DD panel. Each is individually fine. Collectively they are an inconsistency-and-drift risk: when counsel revises one phrasing post-review, I have to chase a dozen files, and a missed one becomes the exhibit a plaintiff's bar quotes. Great looks like: a single `shared/legal/disclosures.ts` keyed registry (each entry: id, surface, verbatim text, applicable-reg citation, version, lastReviewed), with a test that fails if a customer-facing surface renders a hard-coded disclaimer string not sourced from the registry. This is the disclosure analogue of what `disclosureRegistry.ts` already does for statutory document language — extend the same discipline to product copy.
- **First step.** Create the registry, migrate the two most-used components (`required-disclaimer.tsx`, `disclaimer-banner.tsx`) to read from it, add the lint.

### 7. Founder-side compliance cockpit: surface the detectors, DSAR SLA, consent integrity, and matrix freshness in one place
- **Kind:** develop · **Side:** founder · **Effort:** M
- **Why it matters / what great looks like.** We have wonderful instruments — alignment/compliance detectors, DSAR SLA tracking, consent-event chain, the 50-state matrix (currency-stamped June 2026), refusal/appeal ledgers — but they're scattered across routes and tables. Tom (and I, continuously) need one founder surface that answers "is our risk posture green right now?" without a query session. Great looks like: a `/founder/compliance` cockpit showing detector findings open/aged, DSAR SLA breaches, any consent-event write failures (the best-effort inserts that silently log-and-continue today are a blind spot), days-since-matrix-refresh, and the audit-chain verification tip. This is also where the *forcing functions* live — a red tile is the event-driven trigger that beats a calendar.
- **First step.** Aggregate read-only across the existing tables into one founder route + page; start with DSAR SLA + open detector findings (highest signal). Reuse the `/founder/*` focused-route pattern.

---

## Boldest elevation bet

**Make AcreOS the first land-investing platform with a published, evidence-grade Trust & Transparency posture — and treat that as a product, not a page.** Concretely: (a) ship the public Transparency Report (#3), (b) add OFAC counterparty hygiene (#2), (c) wire weekly audit-chain verification with a customer-visible attestation (#4), and (d) anchor all of it to a single living `/trust` hub that links the security page, sub-processor list, DSAR portal, transparency report, AI-disclosure stance, and the data-flow map. Most software in this space treats trust as a footer link to a PDF. We have the rare position — pre-revenue, but with the substrate already built — to make verifiable trust the *reason a careful investor chooses us*. Trust as a moat, published in the open, including the unflattering numbers. That is distinctive, defensible at scale, and exactly the kind of thing that turns a first customer into a reference customer.

---

## Small high-ROI polish refinements

- **Pax composer disclosure rail** (#1 above) — single biggest perception ROI; an afternoon of work.
- **Wire `injectionRateLimiter.recordAttemptIfDetected` everywhere it should already be.** The doc says "every customer-facing AI route should call it before invoking the LLM." Grep each AI route and confirm; any uncovered surface is a hole. Add a test that asserts the call exists on each registered AI route handler.
- **Consent-event write-failure alerting.** `consentEvents.ts` and `customerAudit.ts` are correctly best-effort (never break the user flow), but a silent log-and-continue on a *consent revocation* is the one place silence is dangerous — that table is the plaintiff's-bar evidence chain. Emit a high-priority `audit_events` row on insert failure so the founder cockpit can show it red.
- **Stamp every legal doc with a `lastReviewed` + `nextReviewDue` and surface staleness.** Privacy policy is correctly marked "not yet reviewed by counsel"; the state matrix is monthly-cadenced. Make freshness a *queryable* field, not prose, so the cockpit can flag a matrix cell or policy that has aged past its review window.
- **OSM/data-license attribution + "review-required" county default** already exists — add a tiny "data as of <asOf>, classification <x>" line to the *PDF* report footers to match the in-app provenance chips, so the trust signal survives export.
- **`security.txt` + a real vulnerability-disclosure mailbox.** The /security page mentions vuln disclosure; make sure `/.well-known/security.txt` resolves with a monitored contact. Cheap, and researchers look for it first.
- **Two-factor for the founder seat is half-built** — `routes-admin-recovery.ts` notes the in-house 2FA columns "were never persisted." Either fully wire it (we rely on Clerk MFA today, which is fine) or remove the dead columns so an auditor doesn't find a half-implemented auth control.

---

## The one thing that would most embarrass us

**A sharp first customer opens Pax, asks "should I buy this parcel?", and there is no standing disclosure anywhere on the screen telling them Pax is a tool that surfaces data, not an advisor that decides — and no "AI-generated, verify before acting" rail.** We enforce this server-side, we cite immutable #7 in our forensic ledger, we have the disclaimer components built — and the most-used customer surface, `client/src/pages/pax.tsx`, ships none of it visibly (grep confirms zero standing "verify / informational / not advice" copy on that page). Our entire risk doctrine's first pillar is "tool, never an advisor," and the place that pillar matters most is the only place it isn't shown. That is the gap an attorney spots in ten seconds, and it is a one-afternoon fix. Close it before customer one.
