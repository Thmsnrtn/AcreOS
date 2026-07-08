# Autopilot T0 — Close the Last Mile (de-risked build plan)

**Date:** 2026-06-16
**Source:** adversarial multi-agent audit (4 maps + design + 4 specialist lenses + synthesis). Run `wf_37243809-def`.

## What the audit changed (vs. the naive design)

- **CUT the holdout RCT + Experience-Log edit from T0.** A per-visitor holdout draws treatment + control from the *same live page* → expected lift ~0 (invalid); and at $50/mo land volume the control arm never reaches minimum-N → every artifact sits `pending` forever and `outcomeOf` silently reverts to the mechanical `dispatchSuccess` branch. So **T0 does not touch the frozen learning invariant.** It publishes + attributes to a **founder dashboard**; the causal learning loop is a *later* proposal once real signups exist.
- **Publish onto the land-native parcel-report rail** (`/p/:slug`, which already has sitemap/prerender/OG/view-count machinery) — county/intent-targeted teasers, not generic prose. The one winnable SEO channel.
- **The publish gate is a silent no-op today** (zero eval cases seeded for content) → make it real.
- **Close the witnessed-send laundering hole**: a public broadcast classifies non-customer-facing → skips the tap. Add `outwardClass:'broadcast'` so publishing always needs a human tap.
- **Attribute off the witnessed `marketing_touch` chain** (not the racy `acquisitionUtm` blob); treat as a lower bound; absence ≠ failure vote. Ship **unpublish** + stale-fact TTL alongside publish.

## Build order (all behind `AUTOPILOT_PUBLISH_ENABLED`, default OFF)

**Batch A — Real publish gate (highest leverage; ships first).**
- `claimsGate.ts` (NEW, pure): bans buildability/perc/wetlands *determinations*, investment-return language, fair-housing descriptors; requires a disclosure footer + source+vintage citations on land facts.
- Seed `surface='marketing'` data-grounding eval cases (`dataGroundingEvalCases.ts` + `aiEvalHarness` `toAiTestCaseRows` + migration). **Fail-closed**: `publishGrowthArtifact` asserts ≥1 case for the surface or hard-blocks (turns the silent-pass into a hard block).

**Batch B — Publish onto the parcel-report rail, gated + witnessed.**
- `publishArtifact.ts` (NEW) + extract reusable `publishPublicArtifact`/`unpublishArtifact` from `routes-public-parcel-report.ts`; new `publish_parcel_artifact` dispatch tool; `policyGate` gains `outwardClass:'broadcast'` (→ always needs witness); `simulate.ts` stops hardcoding `reversible=!customerFacing` for broadcasts. Server-side HTML sanitize + outbound-link allowlist + publish-rate cap (≤1/day) + graduated-autonomy ramp (first N publishes/play need founder approval). `AUTOPILOT_PUBLISH_ENABLED` grants publish only, never `/send` (CAN-SPAM wall intact). Unpublish (410 + sitemap lastmod) ships same batch.

**Batch C — Instrument (reuse parcel-report machinery verbatim).**
- Autopilot artifacts join `/sitemap-reports.xml` + prerender OG/JSON-LD + `recordReportView`; county/intent slugs; **bot-filter** the view ledger (UA + real `acreos_anon_id`).

**Batch D — Attribute off the touch chain → founder dashboard (no bandit, no holdout).**
- `marketing_artifacts` + `autopilot_conversions` tables; attribute inside `backfillTouchIdentity` (NOT `getOrCreateOrg`), keyed on exposure; `utm_content` only an unverified hint that must resolve to a real artifact row. Founder-pulse line. Signal **founder-visible only**, never fed to `outcomeOf`.

Flip `AUTOPILOT_PUBLISH_ENABLED` on only after D is verified producing correct attributed-signup rows on a seeded artifact.

## SHIPPED (2026-06-16, gated behind the publish switch)

The last mile closes end-to-end, dormant:
- **Safety:** witnessed-send broadcast fix + `claimsGate.ts` (land determinations /
  investment / fair-housing / disclosure) + the 3-layer publish gate in
  `publishArtifact.ts` (DOMPurify sanitize → link allowlist → claims).
- **Publish:** `publishGrowthArtifact` → existing `community_letters` → `/field-notes/:slug`
  rail + `marketing_artifacts` anchor; daily rate cap; `unpublishArtifact` reversal.
- **Link:** `maybePublishFromDispatch` in the worker consumer + the
  `PUBLISH_OUTPUT_CONTRACT` growth prompt (agent emits a fenced `<<<PUBLISH>>>`
  block; no block ⇒ safe no-publish).
- **Instrument:** `/sitemap-notes.xml` (mirrors `/sitemap-reports.xml`).
- **Attribute:** `attribution.ts` — signup attributed off the witnessed
  `marketing_touch` chain to a REAL artifact row (lower bound; founder-dashboard
  only); surfaced on the Control Center.
- **Control:** DB-backed master switches + the Control Center (`/founder/autopilot/control`).

Remaining T0 polish: seed `surface='content'` grounding eval cases (Batch A — the
claims gate already covers the highest-risk content); bot-filtered view-count;
the graduated-autonomy publish ramp.

## Deferred (separate proposal, gated on real conversion data)
The **correct** causal design: a *publish-time* holdout (suppress publication for a fraction of eligible play-runs → control is genuinely unexposed), unit = play×segment pooled (N accumulates), graded funnel (view→signup→first_value→paid), power made visible ("N insufficient, vote suppressed"), secret-salted arm hash, bot-excluded denominator. Only then raise the `experienceLog` `conversionLift` slot.

## Risks consciously accepted
1. No causal learning in T0 (publish play learns on mechanical signal only → bounded by the per-day cap + graduated-autonomy ramp).
2. Organic SEO is months-not-weeks for a no-authority domain (no auto-distribution — that's a ban/liability trap, stays human-gated).
3. Attribution undercounts (lower bound; never votes failure on absence).
4. Founder-approval friction on first N publishes/play (accepted to bound blast radius on a permanent crawler-amplified surface).
5. Stale-fact liability (auto-expiry via `validUntil` + daily re-ground; bounded window).
