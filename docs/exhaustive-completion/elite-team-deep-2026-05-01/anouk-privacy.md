# Anouk Deschamps — Privacy & Data-Subject Rights Audit, AcreOS

**Lens:** 8 yrs Spotify EU privacy engineering, then privacy-program lead at Notion. I read US-built SaaS code with one question in my head: *if a Schrems-III-era DPA in Hamburg gets a complaint about you next Tuesday, what do they find when they look?*

**Audit window:** 2026-05-01. Reviewed: `server/routes-gdpr.ts`, `server/services/gdprService.ts`, `client/src/pages/privacy.tsx`, `client/src/pages/privacy-settings.tsx`, `client/src/components/cookie-consent-banner.tsx`, `client/src/lib/sentry.ts`, `server/jobs/dataRetention.ts`, `server/middleware/fieldEncryption.ts`, the ten OpenAI call-sites in `server/services/`, plus Sam's security audit and Marisol's CFO audit.

Reads-along-with: `sam-security.md` flagged the `/api/privacy/data-export` and `/api/privacy/data-delete` endpoints as missing for SOC2 Type-1. They actually exist (mounted at `server/routes.ts:1103`) — Sam grepped for the wrong path. They are also **not what the privacy notice says they are.** That's the headline.

---

## 1. One-line verdict

**Defensible against an unsophisticated CCPA "right to know" request today; would not survive a German DPA Art. 30/Art. 28 inquiry, a Cal. AG follow-up question, or any plaintiff's-firm CCPA private-right-of-action complaint that dug past the marketing copy.** GDPR readiness: ~30%. CCPA readiness: ~55%. CPRA readiness: ~25% (sensitive-PI handling is the gap). Sub-processor list exists; DPAs do not. Skip-trace data, AcreOS's highest-trust dataset (R3 in Sam's audit), is **out of scope** of every privacy mechanism on file.

---

## 2. Data subject rights matrix

The legal posture in `client/src/pages/privacy.tsx:145-163` claims access, export, correction, deletion, restriction, objection, portability. The implementation in `server/routes-gdpr.ts` covers two of the seven, partially.

| Right (GDPR / CCPA) | Endpoint | UI | Implementation reality | Gap |
|---|---|---|---|---|
| **Art. 15 / §1798.110 — Access** | `POST /api/privacy/export` | `/privacy-settings` "Download my data" | `gdprService.exportUserData(userId)` returns user row + leads/deals/properties/tasks/teamMessages/supportTickets the **user is `assignedTo`** | **Critical scope error.** The data subject under GDPR is the *natural person* (the lead, the property owner, the borrower). The endpoint exports the *AcreOS user's* CRM workspace, not the data we hold *about* the data subject. A property owner who emails `privacy@acreos.com` has no machinery here. |
| **Art. 16 — Rectification** | none | `/settings` (own profile only) | Owner-of-org can edit their own profile via Clerk + `/api/me`. No flow for rectification of lead/property data on behalf of a third-party data subject. | No endpoint, no UI, no DSAR intake form. |
| **Art. 17 / §1798.105 — Erasure** | `POST /api/privacy/delete` | `/privacy-settings` "Delete my account" | `anonymizeUser` overwrites email/firstName/lastName, deletes agentEvents/teamMessages/supportTickets/tasks/sessions/aiConversations, and anonymizes leads where `assignedTo = userId`. | (a) Deletes *AcreOS user* PII, not the third-party data subject's PII held in `leads`/`properties`/`skip_traces`/`signatures`/`borrowers`. (b) `properties.owner_*` columns are not touched. (c) `skip_traces.results` jsonb is not touched. (d) `signatures.signature_data` (legal artefact) is not touched — defensible if legal-hold reason is documented; today it isn't. (e) No cascade through `webhook_deliveries`, `inbox_messages`, `conversations`, `audit_log`. (f) No 30-day cooling-off / undo window. (g) Doesn't write an audit row (Sam §4). |
| **Art. 18 — Restriction of processing** | none | none | A claim in §7 of `/privacy`. No `processing_restricted` flag on `users` or `leads`. No middleware honors it. | Pure paperwork. Implementation: 0%. |
| **Art. 20 — Portability** | covered by export | same | Export is JSON, machine-readable. ✓ format. ✗ scope (see Access). | Add CSV alongside JSON; document schema. |
| **Art. 21 — Objection** | none | none | Claim made in §7. No `marketing_optout` flag wired to outbound mail or SMS code paths. `transactional` vs `marketing` distinction not present in `email_dispatches`. | Cannot honor. |
| **Art. 22 — No solely-automated decisions** | n/a | n/a | AcreOS makes *recommendations* (`buyerQualificationBot`, `sellerIntentPredictor`, `leadNurturer`) but does not make solely-automated legally-significant decisions. Today, OK. The day the autonomous pipeline auto-rejects loan applicants in `borrowers`, this becomes Art. 22-relevant. | Add explicit Art. 22 carve-out language to the policy: "AcreOS does not make solely-automated decisions with legal effect." |
| **CCPA §1798.120 — Right to opt out of sale/share** | none | none | Policy says "we do not sell." Adequate for today. CPRA "share" definition (cross-context behavioral advertising) is broader — Sentry session replay arguably falls under it depending on configuration. | Add a "Do Not Sell or Share My Personal Information" link in the footer (legally required in CA regardless of whether you sell). |
| **CPRA §1798.121 — Limit use of sensitive PI** | none | none | Sensitive PI per CPRA includes account credentials, geolocation, contents of mail/email. We hold all three. | Add a "Limit the Use of My Sensitive Personal Information" link. |
| **CCPA §1798.135 — Global Privacy Control (GPC)** | none | none | We do not detect `Sec-GPC: 1` request header on landing/marketing pages. As of 2026, Cal. AG considers ignoring GPC a violation. | Add GPC handling on `acreos-landing` (15-line middleware). |

**Net:** the export and delete endpoints are scoped to *the AcreOS customer (user)*, not to the *natural persons whose PII the customer brought in.* That is the inverse of what GDPR asks for. AcreOS is the **processor** for lead/property PII; the customer is the **controller**; AcreOS is the **controller** for the customer's own account data. The current endpoints conflate these and answer only the controller half.

### 2a. The DSAR lifecycle nobody has built

A real DSAR pipeline has six stages, not one button. Today AcreOS has stage 6 only:

1. **Intake** — public form (no auth required — a property owner doesn't have an AcreOS account). `acreos.io/privacy/request`. Categories: access / delete / rectify / opt-out / restrict / object / portability.
2. **Verification** — email magic link (or government-ID for high-value claims) proving the requester is the data subject. Required by CCPA Reg §7060 + GDPR Art. 12(6). Today: 0%.
3. **Triage** — is this a controller-DSAR (about the AcreOS user's own account) or a processor-DSAR (about a third-party data subject)? The latter must be fanned out to every customer who has matching records, with a 30-day SLA back to AcreOS.
4. **Lookup** — multi-tenant fan-out across `leads.email`, `properties.owner_email`, `borrowers.email`, `signers.email`, `inbox_messages.from_email`, `conversations.contact_email`, `signatures.signer_email`.
5. **Action** — apply the operation atomically across all tenants. For deletion: cascade with audit. For access: bundle into a portable archive.
6. **Close** — write to `privacy_events` (proposed), notify requester, retain proof of fulfillment for 24 months per CCPA §1798.130(a)(3).

Today only step 6's *act* exists, scoped wrong, and `privacy_events` doesn't exist as a table.

---

## 3. Privacy notice review (`client/src/pages/privacy.tsx`)

Asher flagged "real estate CRM platform" — he's right. The policy is the wrong shape for the product.

**What's accurate:**
- §6 retention timelines (90d cancellation grace, 30d permanent delete, 30d backup purge) — match `dataRetention.ts` *philosophically* but the job doesn't actually delete the user-identified tables (it purges telemetry/events). The 30-day claim is aspirational.
- §11 CCPA section is well-formed. The "we do not sell" claim is verifiable (no ad SDKs, no data brokerage outbound).
- §12 sub-processor list exists (rare for stage). Decent coverage.

**What's wrong, in priority order:**

1. **Controller/processor distinction is missing entirely.** The notice talks only about "your" data as the customer's. AcreOS is processor for the data subjects whose PII the customer uploads (leads, sellers, buyers, borrowers, signers). The notice owes those data subjects (a) lawful-basis statement, (b) retention period, (c) recipient list, (d) DSAR contact route. None of that is in `/privacy`. Add a **§15 "Data we process on behalf of our customers"** section.

2. **"Real estate CRM platform" undersells what AcreOS is.** AcreOS does skip-tracing (R3), e-signature (legal artefact retention), direct mail (Lob shares physical addresses), SMS (Twilio shares phones), document AI (OpenAI/Anthropic see contracts), buyer matching, seller intent prediction, voice calling. The notice §3 lists generic SaaS purposes. A regulator reads the homepage, then reads the policy, and decides the policy was drafted before product.

3. **§5 "Third-party services" disagrees with §12 "Sub-processors."** §5 lists Stripe/OpenAI/Lob/Regrid (4). §12 lists Clerk/Stripe/Fly/AWS-SES/OpenRouter/OpenAI/Anthropic/Twilio/Lob/Sentry/Regrid/Dropbox-Sign (12). One person reading the policy finds two different lists in the same document. **§5 is dead text** — delete it and reference §12.

4. **§5 OpenAI claim ("not used to train their models") is unverified by configuration.** `server/utils/openaiClient.ts` and `server/services/aiRouter.ts` set `defaultHeaders: { "HTTP-Referer": ..., "X-Title": "AcreOS" }`. Neither sets the OpenAI `OpenAI-Beta` zero-retention header, nor are calls routed through OpenAI's enterprise / zero-data-retention tier. **The claim in §5 of `/privacy` is not what the code does.** Either change the contract with OpenAI (enterprise / DPA / ZDR) and document it, or change the policy. Today they disagree.

5. **§4 BYOK section assumes BYOK exists for AI.** Grep for `userOpenAIKey` / BYOK encrypted credentials in the AI router — most AI calls go through the platform key, not user keys. The BYOK section reads as marketing for a feature that's partial. Re-scope to "BYOK is available for X, Y, Z" and list those.

6. **§9 Cookies is hand-wave.** Doesn't enumerate which cookies (essential vs analytics vs functional), doesn't describe the consent banner, doesn't tell EU users they can withdraw. Required by ePrivacy + GDPR Recital 32.

7. **§10 Children's notice (under-18)** is one paragraph and uses 18, not 13. COPPA is 13. CPRA-sensitive-data-of-minor is 16. EU GDPR Art. 8 default is 16 (some MS lower to 13). State this as: "AcreOS is not directed to anyone under 18 and we do not knowingly collect from anyone under 16." Then say what we do if we discover we have. Today the recourse text is "delete promptly" — say *who* deletes it, in what timeframe, and how to report.

8. **§7 lists rights AcreOS does not implement** (restriction, objection, rectification of third-party DSAR). §7 + §11 + §15 (proposed) should each map a right → an actual mechanism. If there's no mechanism, the policy is offering a right we cannot honor. That's the textbook FTC §5 unfair-and-deceptive case.

9. **No DPO disclosure rules.** §14 lists `dpo@acreos.com` — under GDPR Art. 37, only certain orgs *must* designate a DPO; for AcreOS at current scale it's optional. If a DPO is not formally appointed, don't list one. Listing a DPO who isn't a DPO is a finding.

10. **No "international transfers" section.** AcreOS is on Fly.io US, but European customers' data crosses the Atlantic. SCCs, EU-US DPF certification — none of it is mentioned. For the Canadian-expansion plan in `VERTICAL-EXPANSION-PLAN.md`, add PIPEDA and Quebec Law 25 sections before the first Canadian customer signs.

11. **No breach-notification SLA stated.** GDPR Art. 33 is 72 hours to supervisory authority; CCPA §1798.82 is "in the most expedient time possible." Sam's audit confirms no IR runbook. The notice should commit to the floor.

---

## 4. Sub-processor list — what AcreOS uses, DPA status per

`/privacy` §12 lists 10 sub-processors. Here's the audit:

| Sub-processor | Purpose | Receives | DPA in place? | Standard offering | Required action |
|---|---|---|---|---|---|
| Clerk | Auth + user mgmt | email, name, IP, session, password hash | ✗ unverified | Clerk publishes a DPA + sub-processor list | Sign their DPA; mirror their sub-processors into ours (they use AWS, Cloudflare, Stripe themselves — disclose downstream) |
| Stripe | Payments | name, email, billing address, card (tokenized), tax ID | ✗ unverified | Stripe DPA + SCCs | Sign Stripe DPA via dashboard; enable EU data residency setting if any EU customer signs |
| Fly.io | Hosting / Postgres | **everything in DB** | ✗ unverified | Fly DPA available on request | **Critical — sign before any EU customer.** Verify `fly volumes` are encrypted at rest. Add region pinning. |
| AWS / SES | Email send | recipient email, message body | ✗ unverified | AWS DPA via Artifact | Accept AWS DPA in console; document SES region |
| OpenRouter | AI routing | full prompt incl. PII (see §7) | ✗ — and OpenRouter is a router, downstream providers vary by request | OpenRouter has terms; upstream model providers each have separate terms | **Highest risk.** Replace with direct OpenAI/Anthropic with ZDR, or get enterprise OpenRouter w/ logging-off |
| OpenAI | AI completion | full prompt | ✗ — using free-tier API | Enterprise tier offers ZDR + DPA | Move to OpenAI API w/ ZDR enabled; keep evidence |
| Anthropic | AI completion | full prompt | ✗ — using API | Anthropic offers BAA/DPA at scale | Sign DPA |
| Twilio | SMS / voice | phone, message body, call audio | ✗ unverified | Twilio DPA + SCCs | Sign their DPA; verify call-recording region |
| Lob | Direct mail | full physical address, mail content | ✗ unverified | Lob has DPA + HIPAA BAA | Sign DPA; ensure mailing-list deletion on customer churn |
| Sentry | Error monitoring | URLs, stack traces, IPs, possibly PII in error payloads | ✗ unverified | Sentry DPA + EU region available | Sign DPA; **switch to Sentry EU region** for any EU customer; verify `beforeSend` strips PII (it strips Authorization/Cookie only — not phone/email in URLs or breadcrumbs) |
| Regrid | Parcel data | parcel IDs, addresses queried | ✗ unverified | B2B; DPA available | Sign DPA |
| Dropbox Sign | E-sign (legacy?) | document, signer email | ✗ unverified | Dropbox Sign DPA | Sign DPA, **OR remove from list** — `routes-public-sign.ts` is native e-sign now (per Sam §5 + your Native E-Sign memory). If Dropbox Sign isn't actually used, deleting it from §12 is required (false sub-processor disclosure is a Cal. AG finding). |
| **Cloudflare** (DNS proxy per Infra memory) | DNS / WAF | request metadata, IPs | ✗ unverified, and **not listed in §12** | Cloudflare DPA via dashboard | Add to §12; sign DPA |
| **PostHog / analytics** | (verify if used) | events | ? | n/a | Confirm presence; if used, list |

### 4a. Cross-border transfer mechanics

Every name in the table above except (potentially) Sentry-EU is US-based. EU customer data → US sub-processor = Schrems II territory. Required: (a) AcreOS is on the EU-US Data Privacy Framework, *or* (b) Standard Contractual Clauses (SCCs) Module 2 (controller-to-processor) are signed with each sub-processor *and* a Transfer Impact Assessment is on file. Neither is in the repo. For the Canadian-expansion plan, PIPEDA permits transfers to the US under "comparable protection" assertions, but Quebec Law 25 § 17 requires a Privacy Impact Assessment per cross-border transfer — non-trivial, documented per data category.

**Verdict:** the list is more complete than 90% of seed-stage SaaS, but **zero DPAs are confirmed signed**. We can list sub-processors all we want; without DPAs the GDPR Art. 28(3) chain is broken. If a customer asks for an AcreOS DPA, we cannot in turn show our chain.

**Customer-facing DPA:** does not exist. No `acreos.io/legal/dpa.pdf`. No DPA generation flow. Asher's policy says privacy@acreos.com handles it; in practice, no template exists. This blocks every prospective customer with a procurement function.

---

## 5. Cookie consent + tracking review

`client/src/components/cookie-consent-banner.tsx` + `client/src/lib/sentry.ts`:

**What's correct:**
- Sentry initialization is gated on consent (`initSentryAfterConsent` after click, `initClientSentry` on next pageload checks localStorage). ✓
- Banner shows on first visit, persists choice. ✓
- Decline option exists at parity with Accept (no dark pattern by *button styling alone* — same size, same `min-h-11`).
- `beforeSend` strips Authorization + Cookie headers. ✓ partial.

**What's wrong:**

1. **Not granular.** "Accept all" vs "Decline" is a binary. EDPB guidance (cookies-2023-update) requires per-category consent: *necessary, functional, analytics, marketing*. Sentry session replay belongs to *analytics+functional*. No granular toggles = invalid consent under GDPR.

2. **No revocation UI in product.** Once accepted, there's no "Manage cookie preferences" link in the footer or settings. Recital 42 + Art. 7(3): withdrawal must be as easy as giving.

3. **localStorage as the consent store** is fine for the user, but the *server has no record* of consent at the user/org level. In a dispute ("I never consented"), AcreOS can prove the click only by user attestation. Persist consent (timestamp, version, IP, UA) server-side per user.

4. **No consent versioning.** If the policy materially changes, today's "accepted" carries to the new policy. Add a `policyVersion` field to the consent payload and re-prompt on change.

5. **Sentry session replay at 10% sample is invasive.** Replay captures DOM, including potentially form inputs. Sentry has a `mask` config (default masks text in inputs); confirm `maskAllInputs` and `blockAllMedia` are on. Today the init block doesn't pass either — Sentry defaults handle the mask, but record this in your DPIA so it survives an audit.

6. **GPC not detected.** No middleware on landing or app reads `Sec-GPC: 1` and pre-sets the consent state to declined. Required by Cal. AG since 2022.

7. **Banner uses `aria-live="polite"`** — fine — but on initial render *before* `useEffect` resolves, the banner is hidden. Slow connections may briefly load tracking-related markup before consent settles. Defer all tracking scripts until consent is read; use SSR cookie if banner is keyed to a cookie.

8. **No mention of essential vs non-essential.** Some cookies (Clerk session) don't legally require consent. Others (Sentry replay) absolutely do. The banner treats them as one. Education problem + legal problem.

9. **No cookie inventory.** A defensible privacy program enumerates: cookie name, owner (1st/3rd party), category, purpose, lifetime. AcreOS has none. Run `chrome://settings/cookies/detail?site=acreos.io` after a clean session login + Clerk → SSO → Stripe checkout → support widget, and you'll find ~12 cookies. Document them.

10. **Banner copy is consent-by-continuation.** "By continuing, you agree to..." is *implicit consent*, which the EDPB explicitly rejected in 2020 (it must be "freely given, specific, informed, unambiguous, by clear affirmative act"). Rewrite: drop "By continuing, you agree." Consent only attaches when the Accept button is clicked.

---

## 6. Data retention policy gaps

`server/jobs/dataRetention.ts` is a 50-line file that purges 7 telemetry tables (job_health_logs, agent_events, activity_log, ai_telemetry_events, usage_events, notification_history, revenue_protection_interventions). Retention windows: 30–180 days. ✓ for telemetry.

**Gaps (vs. what `/privacy` §6 promises):**

| Promise (`/privacy` §6) | Reality | Gap |
|---|---|---|
| "Retained throughout subscription" | True for `leads`, `properties`, `deals` etc. | OK |
| "After cancellation: 90d retention" | **No job purges org data 90 days after cancellation.** `organizations.subscriptionTier='cancelled'` is set; nothing follows up. | **Critical.** If a customer cancels, AcreOS holds their leads forever. |
| "Permanent delete within 30d on request" | `anonymizeUser` is synchronous — deletes immediately, not on a 30d clock. | Inconsistent. Either change the policy ("immediate") or add a 30d soft-deletion window with undo. |
| "Backups purged within 30d" | Fly.io Postgres backups: not configured by AcreOS. Default Fly retention varies by plan. | **Unverified claim.** Document Fly's actual backup retention, set explicitly, attest in DPIA. |
| Telemetry retention windows | 30/60/90/180d, sane | OK |
| **Skip-trace data retention** | Not specified anywhere. Skip-trace results live in `skip_traces.results` with no purge. R3 in Sam's audit = highest-trust dataset, infinite retention. | **Critical.** Should auto-purge after 12 months unless a deal references it. |
| **Audit log retention** | Not specified. Sam §4 already flags audit log not tamper-evident. | Set min/max (min: SOC2 wants 1 yr, max: don't keep forever — purge after 7 yr unless legal-hold). |
| **Signature artefact retention** | Forever, by design (legal evidence). | OK *if* documented. Add a §16: "We retain signed documents for 7 years post-execution to satisfy ESIGN/UETA evidence requirements; this overrides deletion requests." |
| **AI conversation history** | `aiConversations` purged on user deletion. No standalone retention policy. | Set a default (e.g., 12 months) and surface it in `/privacy`. |
| **Inbox messages / SMS** | No purge job. | Set a retention (24 months?) and disclose. |

**Defensibility verdict:** the *telemetry* retention story is real. The *PII* retention story is policy-only — there is no enforcement code that deletes PII on a clock. A regulator asking "show me the cron that deletes leads 90 days after cancellation" would find nothing.

---

## 7. AI + privacy specific risks

This is the biggest sleeper finding in the audit. AcreOS makes ~10+ direct OpenAI calls per user-flow (`leadNurturer.ts:183`, `supportBrain.ts:80,394,461`, `buyerQualificationBot.ts:539,717`, `sellerIntentPredictor.ts:577`, `negotiationCopilot.ts:257,383,688,802`, `documentIntelligence.ts:213,275,350,399,503,586`, `voiceCallAI.ts:276,358`, `priceOptimizer.ts:675`, `writingStyle.ts:139,190,309`, `financeAgent.ts:101`, `buyerMatchingAI.ts:715,1020`, `atlasMemory.ts:185`, `sequenceOptimizer.ts:389`).

**`leadNurturer.ts:150-161`** sends to OpenAI:
```
- Name: ${context.firstName} ${context.lastName}
[lead phone, email implied via downstream]
```
This is third-party-data-subject PII (the lead, not the customer) being sent to an LLM provider that — per §5 of `/privacy` — "does not train on it." The code does not configure that guarantee. The default OpenAI API tier *retains* requests for 30 days for abuse monitoring and *may* be reviewed by humans. Anthropic's API does similarly.

**Specific risks:**

1. **PII-in-prompt to OpenAI/Anthropic without ZDR.** The `/privacy` §5 promise is contractually unfounded. Either (a) move to `OpenAI` with Zero Data Retention (must be requested + approved) and Anthropic with no-training opt-out (default but document), or (b) update the policy to say "data sent to AI providers may be retained by them for 30 days for abuse monitoring."

2. **`OpenRouter` is in the sub-processor list.** OpenRouter is a router; the upstream provider for any given request varies. AcreOS cannot reasonably tell a data subject *which third party* received their data on which day. This is incompatible with GDPR Art. 13(1)(e) (recipients) and Art. 30 (records of processing). Either pin OpenRouter to a specific upstream and disclose, or stop using OpenRouter for any flow that includes PII.

3. **No prompt-PII redaction layer.** `installConsoleInterceptor` masks PII *in logs* (Sam §3). There is no equivalent middleware that masks PII *in outbound LLM payloads*. A `redactPIIBeforeLLM(messages)` helper that hashes/tokenizes name + phone + email + SSN before send — and de-tokenizes on receipt — is the standard mitigation. ~1 day of work + a test corpus.

4. **Voice-call audio to OpenAI.** `voiceCallAI.ts` sends audio chunks. Audio carries voice biometrics, which CPRA classifies as Sensitive PI. Need explicit consent for biometric processing + retention disclosure. Today neither exists.

5. **Document intelligence.** `documentIntelligence.ts` sends contract content (signed deeds, purchase agreements) to OpenAI. These contain SSN, DOB, full legal names, addresses, parcel info. This is the highest-density PII payload AcreOS sends out, and it sends it on the consumer API tier.

6. **`atlasMemory.ts` writes long-term memory.** Memory persistence + LLM = a model that can reproduce specific PII on later prompts. If memory is shared across orgs (it shouldn't be — verify `agentMemory.organizationId` is in every read query), it's cross-tenant leakage by way of the model.

7. **Anthropic prompt caching.** If we use Anthropic with prompt caching (which I'd recommend for cost), cached blocks live on Anthropic's side for 5 min. Document this in the DPA disclosure.

8. **No DPIA.** GDPR Art. 35 requires a DPIA for "systematic monitoring on a large scale" or "use of new technologies" — automated lead scoring + AI buyer matching qualifies. None on file.

9. **EU AI Act readiness (Aug 2026 high-risk obligations).** Lead-scoring and buyer-qualification LLM systems probably fall under "limited risk" (transparency obligations: tell the user they're interacting with AI), not "high risk." But the *autonomous pipeline* code path (per `autonomousSalesPipeline.ts`) — if it's making employment-adjacent decisions about borrowers — could escalate. Need an internal classification document by Q3 2026.

10. **Training data leakage potential.** Even with ZDR enabled, a determined adversary in the same chat thread can sometimes extract earlier turns. AcreOS's `atlasMemory.ts` persists turns across sessions — verify org-isolation in every memory read query (`agentMemory.organizationId` must be in every `WHERE`). One missed `WHERE` clause = cross-tenant memory bleed via the LLM, undetectable in normal logs.

---

## 8. The 2-week privacy hardening sprint

Ranked by regulatory blast radius. Items 1–4 are mandatory before any EU/UK customer. Items 5–8 unlock a series-A privacy review. Items 9–10 are the right-to-do-business-here floor.

| # | Action | File / target | Days | Why |
|---|---|---|---|---|
| 1 | **Reframe `/api/privacy/export` + `/delete` to handle data-subject (not user) DSARs.** Add `POST /api/privacy/dsar` accepting `{type: access|delete|rectify, email, verification_token}`. Look up the email across `leads.email`, `properties.owner_email`, `borrowers.email`, `signers.email`, `inbox_messages.from_email`. Verification step (email magic link). Output: structured JSON of every row, across every customer's tenant, that mentions that email. | new `server/routes-dsar.ts` | 3 | This is the single biggest gap. Without it, AcreOS cannot honor a third-party DSAR — and that's 99% of incoming DSARs in our category. |
| 2 | **AI-prompt PII redaction layer.** Wrap every LLM call site in `redactPIIBeforeLLM`. Tokenize {{NAME_1}}, {{PHONE_1}}, {{EMAIL_1}}; persist token map per-request in memory only; rehydrate on response. Block list: SSN, DOB, full address, bank acct (already encrypted at rest, never send to LLM). | new `server/utils/llmRedaction.ts`, all 25+ openai callsites | 3 | Resolves §7 (1)+(3). Removes PII from third-party LLM logs. The single biggest privacy-posture upgrade per dollar. |
| 3 | **OpenAI ZDR + Anthropic DPA.** Apply for OpenAI ZDR program. Sign Anthropic DPA. Configure `defaultHeaders`/dashboard accordingly. Document in `acreos.io/legal/sub-processors`. | account-level + `server/utils/openaiClient.ts`, `server/services/aiRouter.ts` | 1 (paperwork) + 0.5 (config) | Makes the §5 claim true. |
| 4 | **DPA template + customer-facing DPA flow.** PDF template at `acreos.io/legal/dpa.pdf` (Mutual NDA + DPA + Standard Contractual Clauses module 2 + sub-processor schedule). On checkout for $X+ tier, present "request DPA" button → e-sign flow (we own native e-sign — eat our own dogfood). | new `client/src/pages/legal/dpa.tsx` + e-sign integration | 2 | Unblocks every B2B procurement review. |
| 5 | **Granular cookie consent + GPC + revocation.** Replace banner with: necessary (always-on) + functional + analytics + marketing toggles. Persist server-side. Footer link "Manage cookie preferences." Read `Sec-GPC` and pre-set declined. | `cookie-consent-banner.tsx`, new `useCookieConsent` hook, `server/middleware/gpc.ts`, `server/routes-consent.ts` | 2 | EU + Cal. AG. Fixes §5 (1)(2)(6). |
| 6 | **Retention enforcement jobs.** Add three jobs: (a) `purgeCancelledOrgs` — 90d after cancellation, hard-delete tenant data; (b) `purgeStaleSkipTraces` — 12 months unless referenced; (c) `purgeOldAIConvos` — 12 months. All idempotent, all auditable. | `server/jobs/dataRetention.ts` (extend) + `server/index.ts` schedule | 2 | Makes `/privacy` §6 true. |
| 7 | **Privacy notice rewrite.** Add §15 "Data we process on behalf of customers" (controller/processor split). Add §16 e-sign retention exception. Add §17 international transfers + SCCs. Reconcile §5 with §12 (delete §5). Tighten §10 to COPPA-13 + minor-of-CPRA-16 split. State 72-hr breach SLA. Versioned with `policyVersion`. | `client/src/pages/privacy.tsx` | 1.5 | Makes the document defensible. |
| 8 | **DPIA + RoPA (Art. 30 record of processing).** Single doc in `docs/legal/dpia-2026-q2.md` enumerating: processing activity, legal basis, data categories, recipients, retention, transfers, security measures. Required for any GDPR-relevant scrutiny. | new doc | 1.5 | The piece of paper a regulator asks for first. |
| 9 | **Sub-processor DPA round.** Sign DPAs with Clerk, Stripe, Fly.io, AWS/SES, Twilio, Lob, Sentry (EU region), Regrid, Cloudflare. Remove Dropbox Sign from list (or confirm + sign). Add Cloudflare to list. | account-level | 1 (concentrated paperwork day) | Closes Art. 28 chain. |
| 10 | **Audit-log every privacy event.** DSAR submitted, DSAR fulfilled, consent given/withdrawn, sub-processor change, policy version published. Tamper-evident per Sam §4 recommendation. | `server/services/auditLog.ts`, new `server/services/privacyEvents.ts` | 1 | Forensics + regulator response. |

**Total: ~18 person-days.** Two engineers in two weeks. Order-of-operations: 1+2 in parallel week 1; 3+4+5 week 1 second-half; 6+7+8 week 2 first-half; 9+10 week 2 second-half.

### 8a. What this sprint *doesn't* cover (Q3 2026 follow-on)

- **Differential-privacy aggregation for the founder dashboard** — `/founder-home` reads cross-tenant metrics (Marisol §1). Today queries are direct counts; for >100 customers some metrics start to leak per-customer info. Add k-anonymity floor (suppress <5).
- **Pseudonymization at write-time** for skip-trace results (encrypt fields per Sam §3 R3, *and* tokenize names/phones into a separate keyed map so the dossier-row alone is meaningless without the keyring).
- **Vendor-risk register.** Quarterly review of each sub-processor: are they still SOC2'd, did their policy change, did they add new sub-sub-processors? Spreadsheet today; should be a row in a `vendor_assessments` table with quarterly-review SLA.
- **Privacy training for engineers.** 1-hour internal session per quarter. Topics: PII in logs, PII in prompts, DSAR routing, breach IR. Document attendance for SOC2 evidence.
- **Privacy review checkpoint in PR template.** Question on every PR: "Does this change introduce PII collection, processing, sharing, or retention? If yes, link DPIA section." Forces awareness without bureaucracy.
- **Annual penetration test of DSAR + delete flows.** Combined with Sam's recommended pen-test of the sign flow. The DSAR endpoint is the most-likely target of a "data subject" who is actually a competitor probing for tenant-isolation bugs.

---

## Closing

The team has done two things very right that almost no one at this stage does: a real cookie banner that actually gates Sentry, and a sub-processor list. That's a higher floor than 90% of YC-stage SaaS.

The team has done one thing very wrong: shipped a privacy notice that promises seven data-subject rights, implements two of them, and aims those two at the wrong subject. That gap — between policy and code — is the one a plaintiff's firm reads as `Cal. Civ. Code §1798.150` damages exposure. It's also the gap a German DPA reads as Art. 5(1)(a) lawfulness/transparency violation.

The skip-trace dataset Sam flagged as R3 is the single piece of data I would not want to be holding when the first complaint lands. It is the most sensitive dossier we possess, it is at-rest plaintext, no DSAR endpoint touches it, no retention rule purges it, and no DPA covers the providers we acquired it from.

Two weeks of focused work and AcreOS goes from "would lose a tribunal" to "would defend successfully." Skip those two weeks and the first time we encounter a sophisticated regulator — which the Canadian-expansion plan in `VERTICAL-EXPANSION-PLAN.md` makes inevitable — we lose the customer, the cohort, and the headline.

— Anouk
