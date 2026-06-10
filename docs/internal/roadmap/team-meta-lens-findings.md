# Team Meta-Lens System Review — 2026-06-08

All 11 team members + Solene reviewed the *entire* system from their own highest vantage (read-only, grounded in real files). This is the synthesis.

## The one meta-truth (every lens hit a version of it)

**AcreOS's problem is not missing machinery — it's machinery that's built but not switched on, not watched, or not enforced.** The Jun 6–8 deploy outage was the first visible symptom of a systemic pattern that shows up in nearly every domain:

- The **deploy-failure alert** is a literal `echo` (Tess). The **external pinger** the worker-heartbeat was built to feed was never hired (Tess). **Prometheus + OTel** are configured but not running (Tess).
- The **CI type gate runs at a smaller heap than deploy** — it structurally cannot catch the OOM it's meant to gate (Iris).
- The **"real Pax confidence"** path has **zero production callers** — it's the detector heuristic measuring itself (Andrei).
- The **recourse loop** only runs when the founder opens a tab — no cron heartbeat (Rafe). The **welcome email** is a stub (Rafe). **Support tickets** get no first response (Rafe).
- The **cost gates fail open**; the only fail-*closed* one is set 100× too low (Lena). The **ensemble's own spend** has no pre-dispatch cap (Lena).
- **Securities write-paths** depend on a feature gate that **fails open** and bypasses for enterprise + founder — not actually dark (Beatrice).
- **Live fabrication** still ships: skip-trace invents verified PII, analytics return `Math.random()` (Quinn).

**"Real" must mean running + watched + enforced — not merged.** That's the organizational lesson under all of it (and the deeper form of my own "local-green ≠ shipped" finding).

---

## Prioritized action tiers (synthesized across lenses)

### P0 — Safety / legal / honesty (do now; mostly S effort, high-to-critical consequence)
1. **Securities rails actually dark** (Beatrice). Add a hard, env-gated, in-router 404 on `securitize`/`createSecuritization`/`capitalRaise` write paths — independent of the fail-open feature gate, enterprise-tier bypass, and founder bypass. *The only finding with criminal (not civil) exposure.* `routes-capital-markets.ts`, `routes-marketplace.ts`. **S.**
2. **Skip-trace PII fabrication** (Quinn). `routes-leads.ts:1635` fabricates "verified" phones/emails/relatives/prior-addresses via `Math.random()` and bills $0.50 — while a real BatchData provider exists. Route to the provider or return honest "unavailable," never mint `verified:true` without a source. **M.** *Same class as the tax-fabrication already fixed.*
3. **Truth-immutable as a CI lint rule** (Quinn, meta). Block `Math.random()` (and equivalents) in any customer-fact path. Mechanical enforcement so honesty isn't re-audited by hand each time. **M.**
4. **Remaining live fabrications** (Quinn): randomized pipeline analytics (`storage.ts:5263/5315` — `getDealVelocity`/`getConversionRates` discard the real query, return random), satellite "change detected" NDVI badge (`satelliteImageUpdate.ts:57`), fabricated impact scores feeding the autonomous engine (`productEvolutionEngine.ts:306`). → real or honest-empty. **M.**

### P1 — We're blind (reliability/observability; ~S, $0, corroborated Tess+Iris+Lena)
5. **External pinger + stale-release detector + real deploy alert** (Tess #1). UptimeRobot/Better Stack on `/api/health/cached` + `/api/healthz` + `/api/health/worker-heartbeat` (page on `stale`), plus an hourly "live SHA == origin/main?" check, plus replace the `echo` with a real page. ~1hr, $0. Closes the 2-day-MTTD class.
6. **Unify the tsc/build gate** (Iris #1 + Tess #2). One pinned heap **under** the ~7GB runner RAM (e.g. 6144), non-incremental for the gate, and make `ci.yml` call the same `npm run check` as deploy. Stop running CI weaker than deploy. **S.**
7. **Bound the ensemble + fix the cost-gate inversion** (Lena #1/#2). A pre-dispatch `BudgetExceededError`-style throw when month-to-date `agent_dispatch` spend crosses red; raise the fail-*closed* `aiCostCeiling` to sit just above the summed soft budgets. **S-M.** The ensemble is the largest current cash cost and the only unbounded one.

### P2 — Path to first paying customer (FINISH tasks, not builds)
8. **The 4 funnel credentials** (Maren #1) — SES ✓, Mapbox ✓, Stripe ✓ (now live post-deploy); **Regrid** is the one remaining (needs account) so real parcel discovery + `first_property_added` work. Then run one real land-investor through source→…→service.
9. **Activate the dormant lifecycle journeys** (Rafe) — recourse-loop cron heartbeat (`aggregateAndDraft` every 30-60m + push), support-ticket AI first-response, un-stub `handleWelcome` for free/trial. All **S**; all "defined not running."
10. **Conversion** (Soren #1/#2) — repoint the Hero secondary CTA to the live parcel-check (it's "the cheapest acquisition channel we have," currently buried) and fix the "Watch a 90-second demo" copy that delivers a text scroll. **XS-S.**
11. **Persona-aware sample data** (Rafe #2) — `generateSampleData` is land-flipper-shaped; a note-servicer who clicks it lands in the exact mock the persona work just removed everywhere else. **M.**

### P3 — Debt, honesty hygiene, strategic
- Mobile-nav doctrine fix — a Settings control that silently does nothing (Krieger #1, **S**); CAN-SPAM visible footer missing on growth emails (Beatrice #2, **S**, statutory); model-version single source of truth + connect model confidence + cost table 3× wrong (Andrei #1/#2); OFAC consolidate 3 matchers → 1 (Iris #3, correctness); crown-jewel audit events un-chained (Beatrice #3); dev encryption static-key fallback hard-require (Beatrice #4); spinner→skeleton sweep (Krieger #3); eval gate measures tone not grounding (Andrei #3); retrieval precision unmeasured (Andrei #5); orphaned QuickAddSheet + 2 ungated `:hover` (Krieger); 164-page + founder-route sprawl census (Maren #2/#5); centralized `TAX_ADVISORY_COPY` + tax_sale_* orphan sweep (Beatrice #5).
- **Strategic bet (Iyari #1):** productize the **longitudinal parcel graph** — un-backfillable, already minting on every lookup, external API surface already built ("PropStream shows you today; AcreOS shows you the story") — and point Pax-as-agent at *trajectories*. The moonshot that compounds the moat.

---

## Per-lens single recommendations (the headline from each seat)
- **Iris (CTO):** unify the type-check gate — CI currently can't catch the failure that breaks deploy.
- **Tess (SRE):** hire the external observer — we're structurally unable to know we're down.
- **Beatrice (CRO):** the securities rails aren't actually dark — close the three bypass vectors.
- **Quinn (Alignment):** kill the skip-trace PII fabrication; make truth a lint rule, not a periodic sweep.
- **Lena (CFO):** bound the ensemble's spend and make the fail-closed ceiling the master limit.
- **Andrei (AI/ML):** fix the model source-of-truth, then connect model confidence to the calibration loop.
- **Maren (CPO):** it's a *finish* task — 4 credentials + 1 validated loop, not more build.
- **Rafe (CCO):** give the recourse loop a heartbeat — it only beats when the founder looks.
- **Krieger (UX):** resolve the mobile-nav doctrine conflict (a control that lies).
- **Soren (CGO):** make the live parcel-check the Hero's proof — stop gating the claim in front of the demo.
- **Iyari (Future):** turn on the longitudinal parcel graph as a product + Pax's substrate.
- **Solene (COO):** make "real" mean running + watched + enforced in CI — not merged.
