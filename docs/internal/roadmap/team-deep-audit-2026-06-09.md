# Team Self-Directed Deep Audit — 2026-06-09

Each of the 11 team members ran their own subagent audit, shaped however they chose, through their own lens. No coordination. Instruction: go for DEPTH (the highest-leverage thing only that lens would find), verify against code, cite file:line.

## The meta-truth (independently converged)
**Nine of eleven lenses surfaced the same shape of defect: "built but unwired."** The machinery exists; the last mile is the gap. This is the prior team-meta-lens truth ("machinery built but not switched-on/watched/enforced") rediscovered and deepened at the code level. The upside: most champions are *wire two existing things together*, not *build new* — high leverage, mostly S/M scope.

| Lens | The thing that's built | …but unwired |
|---|---|---|
| Iris | the `audit_events` immutability trigger+hash pattern | never applied to the crown-jewel `parcel_observations` |
| Maren | the `autonomyGuardrails` kernel (levels, envelopes, undo) | not wired to the Pax tool path; `paxAutonomyLevel` is dead config |
| Andrei | the Brier/calibration engine + `confidenceBand` scaffold | measure founder agents / dead; the autonomous support-resolver is calibration-blind |
| Quinn | founder-bypass loop + audit-chain verifier | read markers nothing writes / verifier never runs → **published `founderBypassCount` is permanently 0 (a false public metric)** |
| Tess | `/api/jobs/health` + jobSupervisor | query a table targets never write; cover 29% of jobs; no deadman → a job can go dark silently |
| Iyari | parcel-biography feature engine + `parcel_alerts` labels | never connected; deal-feed ranks `ownerMotivation` from the wrong engine (neutral 50 for cold parcels) |
| Rafe | the Acre Index network substrate | invisible at the cancellation moment + a path-typo 404; churn-rescue is one-shot (degrades to 0 coverage as base ages) |
| Lena | `computeCostUsd` cached-token discount | not passed through → AI COGS overcharged ~8× on cache-warmed calls (margin understated + quota over-consumed) |
| Beatrice | the `assert-entity-org` injection defense | not applied to `db_query_write` (arbitrary SQL, no WHERE/org scope, injection sink, SQL hidden in confirmation) |
| Soren | the Land Credit Score product | SEO-orphaned (no sitemap/robots/prerender) + non-embeddable → the distribution flywheel is unbuilt |
| Krieger | the Radix `CommandDialog` primitive | bypassed → the global ⌘K palette is a non-modal "modal" (no focus trap/restore/scroll-lock; `aria-modal` lies) |

## Prioritized tiers (Solene synthesis)

### 🔴 Tier 1 — Honesty / Integrity / Security / Financial correctness (ship first)
- **Quinn F1 — `/transparency` `founderBypassCount` publishes a guaranteed-false `0`.** Active misstatement on the public accountability surface; invisible to the no-fabrication ratchet (it scans `Math.random`, not "real query against a column nothing writes"). Fix: write a real bypass marker + the review-write path + a test. ~1 day. **Most constitutionally urgent.**
- **Beatrice F-A — `db_query_write` = unguarded arbitrary SQL + indirect-injection sink.** Unbounded multi-tenant blast radius; confirmation hides the SQL. Fix: reject no-WHERE / require org-scope (with an explicit louder `platform_wide` ceremony for legit ops), SQL-expanded-by-default confirmation, untrusted-data boundary in the persona. ~1–2 days.
- **Iris F-A — `parcel_observations` (the "balance sheet") has no DB-level immutability,** only a comment. Fix: port the `audit_events` BEFORE UPDATE/DELETE trigger (S) + hash chain (M, co-design w/ Beatrice).
- **Lena F1 — prompt-cache discount discarded in both cost paths → ~8× AI COGS overcharge** on cached calls (margin wrong + customers throttled early). Fix: pass `cachedInputTokens` through `estimateCost` + the quota `computeCostUsd`. ~½ day. (Margin line steps *down* when it lands — that's the correction.)

### 🟠 Tier 2 — Correctness / Reliability (silent degradation)
- **Tess — deadman job-roster monitor:** a `JOB_ROSTER` + a tick that pages when a job's last activity exceeds 2× its interval. Closes the "job went dark, all alarms green" blind spot. S.
- **Rafe — fix the Acre Index path-typo 404 + surface network-loss at cancellation + add churn-rescue cooldown** (one-shot → re-fires on recovery). + fix the `offeredPause` metric lie. S.
- **Quinn F2 — schedule `verifyAuditEventsChain` (it's never run) + page on `ok:false`.** ~20 LOC. Tamper-evidence with no verifier is theater.
- **Andrei — close the calibration loop on the autonomous support-resolver** (outcome label: reopen/CSAT → `pax_observations` + revive `confidenceBand`). The one path Pax acts on customers unsupervised is calibration-blind. Migration + ~40 LOC. Phase 2: shadow mode.

### 🟡 Tier 3 — Strategic product / growth bets (bigger upside; some are founder-direction calls)
- **Maren — the "Pax acted" loop:** wire ONE end-to-end verb (first-follow-up) through the dead autonomy kernel + show it in onboarding. The minimum viable proof for value-based repricing. ~1 sprint. **Founder-direction: do we move Pax from advisor → operator?**
- **Iyari — log-native seller-likelihood scorer + `parcel_alerts` backtest.** Connects the orphaned feature engine to the deal-feed ranking; proves the longitudinal moat is predictive with a one-query backtest. ~2 days for v0 heuristic.
- **Soren — LCS SEO + embeddable:** sitemap/robots/prerender the owned-noun + build `/land-credit-score/embed` + `/tools/parcel-check/embed`. The distribution flywheel. ~1 session. (+ fix `/why` prerender silent-skip → build error.)
- **Krieger — route ⌘K through `CommandDialog`** (focus trap/restore/scroll-lock, honest `aria-modal`) + keyboard-operable wizard tier cards. ~1 PR.

## Cross-cutting dependencies named by the team
- The autonomy spine (Maren kernel + Andrei calibration + Beatrice db-tool + Quinn permission ladder) is **one system** seen from four seats — sequence them together: calibrate → guard → wire → govern.
- Lena F1 feeds the now-honest founder Money surface (the margin input was inflated upstream).
- Rafe F3 (biased save-rate) distorts Lena's LTV inputs — fix before modeling deflection.
- Founder-infra 🔑 (the `DEPLOY_ALERT_WEBHOOK`/on-call channel) gates Tess's deadman *paging* — same unresolved secret as the deploy alerter.
