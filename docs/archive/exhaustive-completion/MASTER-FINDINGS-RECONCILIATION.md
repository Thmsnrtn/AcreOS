# Master Findings — Reconciliation (Phase 1 output)

**As of 2026-05-08.**

The 211-persona audit synthesized into `_MASTER-FINDINGS.md` is dated
2026-05-01. This doc reconciles every P0 (24) and the high-impact P1 buckets
against current `main` to mark which items have shipped, which are partial,
and which remain open. Sources: `git log --all`, `shared/schema.ts`,
`server/services/*`, `docs/runbooks/*`.

**Top-line:** The big pre-launch sweep is overwhelmingly done. Of the 24 P0s,
**21 are ✅ shipped, 1 is 🟡 partial (LAR overlay deferred), 1 is 🟥 open
(Dropbox Sign event idempotency), and 1 is 🚧 explicitly deferred 90 days
(white-label DNS/cert pipeline).** P1s require a similar verification pass —
spot checks below show several large clusters (Eleonora deliverability, verb
canon + apology shape, glossary registry, persona-leak ESLint rule) already
shipped.

The conclusion: the rock-solid path isn't a multi-week P0 build-out. It's a
short residual sweep + a deeper P1 verification + the post-2026-05-01
re-sweep against the surfaces we've shipped since.

---

## Status legend

| Symbol | Meaning |
|---|---|
| ✅ | Shipped, verified by either schema field, route handler, dedicated commit, or runbook artifact |
| 🟡 | Partial — core shipped but a stated sub-piece (e.g. LAR overlay) deferred |
| 🟥 | Open — work not started or only schema scaffolding present |
| 🚧 | Explicitly deferred with a target date or revisit trigger |

---

## §1. P0 reconciliation (24 items)

### Wave A P0s (15)

| # | Finding (abbr) | Status | Evidence |
|---|---|---|---|
| P0-1 | Six conflicting tier-price tables → single source of truth | ✅ | `shared/billing/tier-pricing.ts` (commit `b1150fa7` codemod across 6 sites; `0c8ba989` merge); consumed by `routes.ts`, `routes-team-readiness.ts`, `routes-subscription.ts`, `routes-support-customer-context.ts`, `seed-products.ts` |
| P0-2 | `isFounderAdmin` instead of founder-check leak | ✅ | Used in 80+ admin endpoints (`routes-admin.ts:659+`) |
| P0-3 | Signed-doc immutability + `documentContentHash` | ✅ | `signatures.documentContentHash` (`schema.ts:5566`); commit `f573f00f` |
| P0-4 | Replace 2FA shim with Clerk-native MFA | ✅ | `server/middleware/requireClerkMFA.ts` (165+ lines); legacy `require2FA.ts` deprecated |
| P0-5 | Encrypt skip-trace results jsonb | ✅ | `fieldEncryption.ts` consolidation (commit `0c51618e`); `skipTraces.results` jsonb persists ciphertext |
| P0-6 | `mutations.retry: false` default + `Idempotency-Key` infra | ✅ | `client/src/lib/queryClient.ts:214-262` UUID-v4 helper + opt-in (commit `f35a4b4e`) |
| P0-7 | `eSigningService.sendForSignature` row lock | ✅ | commits `afcf3f7b` + `af173966` (SELECT FOR UPDATE) |
| P0-8 | Persona codename leaks → ESLint + codemod | ✅ | commits `3e9b4e95` (ESLint rule `no-founder-codenames-in-customer-jsx`), `7e286d12` (codemod 9 surfaces), `f6d7fae2` (AI-prompt scrub) |
| P0-9 | Twilio inbound SMS replay protection | ✅ | commit `dc8c8f9f` — unique partial idx on `messages.external_id` + sig-validate fail-closed |
| P0-10 | **Dropbox Sign webhook event-level idempotency** | 🟥 | `processDropboxSignWebhook` in `eSigningService.ts:381-440` mutates `generatedDocuments` directly with no atomic claim, no state-machine guard, no PDF pin. Find: zero `onConflictDoNothing`, no `event_id` table. **Phase 2 work item.** |
| P0-11 | SendGrid event webhook + Eleonora deliverability foundation | ✅ | commit `b21295af` full DKIM/SPF/DMARC + List-Unsubscribe + warmup + bounce-FL; webhook at `routes-sendgrid-events.ts:191` |
| P0-12 | F1 SSRF on `/api/webhooks/test` | ✅ | commit `3f1c8aea` (validateUrl + DNS-rebinding + 4 call sites); `7ce08c6a` re-enabled DNS resolution check |
| P0-13 | F2 inbound-email webhook auth | ✅ | commit `5ab5f408` (SES+SNS sig verify + replay drop); `678c282d` |
| P0-14 | Indirect prompt-injection guard on inbound email body | ✅ | commit `c8a26780` (Pax response-shape v2 + indirect-prompt-injection guard) |
| P0-15 | Invite-token rate-limit + hashing + audit-log redact | ✅ | commit `e0c2a458` (invite-token hashing + per-org caps) |

### Wave B NEW P0s (9)

| # | Finding (abbr) | Status | Evidence |
|---|---|---|---|
| P0-16 | Hardcoded `00-0000000` EIN/TIN trashes every 1099 | ✅ | commit `25dba180` (kill hardcoded payer EIN / recipient TIN + correct 1099-INT shape); `7f28a2b4` capture org tax identity in onboarding. Constants now exist as `PLACEHOLDER_*` sentinels that throw `TaxIdentityError` if encountered (`bookkeeping.ts:391-397`). `organizations.ein` column shipped (`schema.ts:181`) |
| P0-17 | Cesar TX §5.069/§5.072 disclosure missing on contracts-for-deed | ✅ | commits `8635ba9c` + `8f598c3f` (TX §5.069 + NY §307 disclosure registry + pre-dispatch validator block); `server/services/disclosureRegistry.ts` |
| P0-18 | Aniyah Indian-Country `landStatus` enum + LAR overlay | 🟡 | `properties.land_status` shipped (`schema.ts:1028`, default `'unknown'`); auto-action blockers shipped (commit `7ceefbf0`, `254c9838`); manual-verify UI shipped. **LAR (BIA Land Area Representations) shapefile overlay explicitly deferred** per the same commit. **Phase 2 item: ship LAR overlay.** |
| P0-19 | Annual subscription path | ✅ | `organizations.billing_interval` column (`schema.ts:60`); `displayPriceYearly` (`schema.ts:12393`); Stripe yearly Prices created in `seed-products.ts`; `priceYearlyCents` peer in `tier-pricing.ts` |
| P0-20 | Cuthbert white-label DNS/cert pipeline | 🚧 | commit `7a3644c9`: "white-label parked 90 days (target 2026-07-15)" — explicitly deferred with a date and revisit trigger. Two parallel schemas (`whiteLabelConfigs` + `whitelabelTenants`) still present pending consolidation. |
| P0-21 | Magdalena CSV-import 500-row ceiling | ✅ | commits `92f07d91` + `fbdc9361` (Magdalena 50K import + history preservation + Tobiah single-archive export consolidation). `routes-import-export.ts:33` MAX_CSV_IMPORT_ROWS=500 is now the SYNC threshold; rows > 500 queue an `import_jobs` row processed by `services/migrationJobs.ts` (50K cap) |
| P0-22 | Coriander recovery console replaces psql window | ✅ | `server/routes-admin-recovery.ts` (862 lines); UI commit `29a4426e` (sessions/2FA/autopay/ownership/password-reset); registered at `routes.ts:1826` |
| P0-23 | Saskia legal-hold / spoliation prevention | ✅ | `legal_holds` table (`schema.ts:4667-4685`); commit `6e56dc74` (legal-hold mechanism + delete-blocker + retention exclusion + founder UI) |
| P0-24 | Boniface DR drill | ✅ | `docs/runbooks/07-database-restore-from-snapshot.md` exists; broader runbook set under `docs/runbooks/` |

### P0 summary

- **21 ✅ shipped** (P0-1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14, 15, 16, 17, 19, 21, 22, 23, 24)
- **1 🟡 partial** (P0-18 — LAR overlay deferred; everything else shipped)
- **1 🟥 open** (P0-10 — Dropbox Sign event-level idempotency)
- **1 🚧 explicitly deferred 90 days** (P0-20 — white-label parked through 2026-07-15)

---

## §2. P1 reconciliation (spot-checked across the 7 sub-buckets)

The 67 P1s are too long to enumerate one-by-one in this pass. Spot-check
results show large clusters already shipped; a more granular walk-through
will happen during Phase 4 grouping.

### §2.1 Brand voice / microcopy / empty states (P1-1 through P1-10)

| # | Finding (abbr) | Status | Evidence |
|---|---|---|---|
| P1-2 | Codify apology shape; verb canon; glossary; Read-aloud TTS | ✅ | commit `b9f37b4a` (verb canon `lib/labels.ts` + StatusBadge + codemod ~20 sites); `82415705` (ESLint rule); `c267fbc5` (plain-English error mapping + 30-term glossary tooltip registry + voice docs) |
| P1-1, P1-3..P1-10 | (operator-class pricing, generic loading, empty states, etc.) | 🟡 | Verify per-item during Phase 4 |

### §2.2 Reliability + idempotency + correctness (P1-11 through P1-20)

| # | Finding (abbr) | Status | Evidence |
|---|---|---|---|
| P1-15 | DB connection pool math + pgBouncer | ✅ | commit `4af19252` (pgBouncer config + pgvector/pg_trgm/pg_stat_statements + 7 missing indexes) |
| P1-19 | First-party object storage + EXIF preservation | 🟥 | Not directly verified; defer to Phase 4 |
| P1-11..18, 20 | (campaign send dedup, encryption module, setInterval timers, REDIS_URL, Sentry, etc.) | 🟡 | Spot-checks needed in Phase 4 |

### §2.3 IA + tax + billing + security hardening (P1-21 through P1-34)

Spot-checks needed in Phase 4. Settings tab consolidation (P1-26) and
duplicate-route cleanup (P1-27) likely partial; tier-pricing already
consolidated under P0-1.

### §2.4 AI / eval / observability (P1-35 through P1-46)

| # | Finding (abbr) | Status | Evidence |
|---|---|---|---|
| P1-43 | pgvector instead of jsonb embeddings | ✅ | commit `4af19252` ships `pgvector` extension along with pg_trgm + pg_stat_statements |
| P1-44 | Wire `fullTextSearch.ts` Layer 3 | 🟡 | `pg_trgm` extension shipped; route wiring needs verification |
| P1-35..42, 45, 46 | (eval harness, ai-router migration, deprecated models, voice TTS, etc.) | 🟡 | Phase 4 walk-through |

### §2.5 NEW Lifecycle ops (Wave B Batch 7) — P1-47 through P1-57

| # | Finding (abbr) | Status | Evidence |
|---|---|---|---|
| P1-47 | Sigfried deprecation playbook | 🟡 | Some headers exist; need to verify sunset dates registered |
| P1-48 | Lavender close infrastructure (chart-of-accounts, double-entry, trial balance) | 🟥 | No commits found; Phase 4 P0/P1 of lifecycle-ops sweep |
| P1-49 | Renoir reactivation context endpoint + win-back ladder | 🟥 | Phase 4 |
| P1-50 | Asher-takeover account-security surface (`/account/security`) | 🟡 | Backend covered by P0-22 recovery console; user-facing twin needs check |
| P1-51 | Eulalia RON or hard guard | 🟥 | Phase 4 |
| P1-52..54 | Esther post-closing, Hartwell title API, Mireille DNC scrub | 🟥 | Defer to partner-API tier (P3 / Q4 2026 per master findings §14) |
| P1-55 | Wallis percentage-rollout feature flags | 🟡 | Need verification in feature-flag schema |
| P1-56, 57 | Augustin cyber UW + Cordelia E&O | ✅ | Mapped to existing P0/P1 items per master findings §1.3 |

---

## §3. Open work — sequenced for Phase 2 + 4

### Phase 2 (P0 residuals — small)

| Item | Effort | Notes |
|---|---|---|
| **P0-10** Dropbox Sign webhook idempotency | 1d | Atomic claim + state-machine guard + PDF pin on completion. Mirror Stripe webhook pattern in `webhookHandlers.ts`. |
| **P0-18 LAR overlay** | 3d | Phase B of the original landStatus commit. Pull the BIA Land Area Representations shapefile, store as PostGIS geom, render on parcel map, auto-flag parcels intersecting tribal-trust boundaries. |
| **P0-20 white-label** | parked | Revisit at 2026-07-15 per commit `7a3644c9`. No work this phase. |

### Phase 4 (P1 + lifecycle-ops verification + execution)

Domain groupings (pruned of items already shipped):

1. **Brand/microcopy residuals** — operator-class pricing decision (P1-1), per-item shapes for sites not in the codemod's 20.
2. **Reliability hardening** — first-party R2 object storage with EXIF pinning (P1-19), Sentry per-route release stamping (P1-17), web-vitals install (P1-20), AI per-org rate limit (P1-34), Stripe `apiVersion` pinning (P1-22).
3. **IA hardening** — settings 17→7 tabs (P1-26), duplicate-route cleanup (P1-27), lead-detail/deal-detail URL-syncable routes (P1-28).
4. **Lifecycle-ops new surfaces** — *the largest cluster of remaining work*:
   - `/founder/monthly-close` (Lavender — P1-48)
   - `/founder/year-end` + `/founder/audit-prep` (Hilda + Bartholomew)
   - `/account/cancel` retention pitch (Vesper P1-6)
   - `/account/reactivate` (Renoir P1-49)
   - `/account/transfer-ownership` (Martin estate-executor)
   - `/legal-holds` operator UI (Saskia — backend already shipped P0-23)
5. **AI + observability deeper** — eval harness (P1-35), top-10 ai-router migration (P1-36), deprecated `gpt-4-turbo-preview` purge (P1-37), compliance-AI Opus 4.6 + post-validator (P1-38), voice TTS Phase 1 (P1-45).
6. **Wallis percentage-rollout flags** — small but high-leverage.
7. **Vesper "Downgrade instead" handler wired to plan picker** — 0.5d copy/UX fix.

### Phase 3 (post-2026-05-01 re-sweep)

Three Explore agents in parallel; output `post-may1-resweep.md`.

- Audit FF-3 1099-NEC generator vs Olympia §1's 1099-INT critique
- Audit BH-2 tenants/leases/screening fields vs Cordelia/Caspian FCRA stance
- Audit `/founder/recovery-console` vs Asher-takeover §4 step-7 spec
- Re-verify the 6 vertical personas' "5 features I'd build" against shipped commits

### Phase 5 (legal-review-queue)

Items to add as scaffolded-pending-counsel (legal-review-queue.md):
- TX §5.069 disclosure registry (P0-17 is shipped; the `attorneyReviewedAt` stamp is the next step before live use)
- NY §307 disclosure registry (same)
- Indian-Country auto-action blockers (P0-18 partial)
- Legal-hold scope-resolution (P0-23) — depends on per-case attorney attestation
- (Future) BH-1 tenant screening fields when FCRA workflow ships

---

## §4. Conclusions

1. **The pre-launch P0 sweep is essentially complete.** Of the 24 master-findings P0s, only one (P0-10) needs a same-day fix and one (P0-18 LAR overlay) needs a focused 3-day phase-B build. P0-20 is explicitly deferred until 2026-07-15.

2. **The P1 backlog is the real "rock solid" workstream.** Spot checks show several large P1 clusters already shipped (Eleonora deliverability, verb canon, apology shape, persona-leak codemod, glossary registry). Phase 4 needs a granular walk-through to identify the open 30-50% rather than re-doing the closed half.

3. **Lifecycle ops is the new vertical.** The Wave B Batch 7 surfaces (monthly-close, year-end, audit-prep, reactivation, estate-executor, legal-holds operator UI) are the largest cluster of unbuilt surfaces. They aren't a single product surface — they're 8-10 small focused routes under `/founder/*` and `/account/*`, each one straightforward (analogous to FW-4 inspection-detail).

4. **The 211-persona corpus continues to pay dividends without re-mining.** _MASTER-FINDINGS.md was the right artifact to anchor against; the work since 2026-05-01 has chipped through it methodically. The risk is regressions or new gaps introduced by the post-2026-05-01 surfaces — Phase 3 catches those.

5. **Recommended path:**
   - **Today:** Phase 2 (P0-10 Dropbox idempotency + P0-18 LAR overlay) — 1 session
   - **Next:** Phase 3 re-sweep — 1 session
   - **Then:** Phase 4 lifecycle-ops sweep — sequenced by impact, multi-session
   - **Continuous:** Phase 5 legal-review-queue maintenance

---

*Generated 2026-05-08 from `git log` + `shared/schema.ts` + `server/services/*` + `docs/runbooks/*`. Update this doc as items flip ✅.*
