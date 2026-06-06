# Existing-state honest assessment

**Companion to:** `00-blueprint.md`
**Owner:** Soren
**Date:** 2026-06-05
**Purpose:** Capture what's actually shipped today vs. what the blueprint requires, and surface the founder-call items.

---

## 1. The `/letters` surface — voice contradiction

### 1.1 What ships today

- `client/src/pages/letters-archive.tsx` (114 lines) — public archive at `/letters`. Header copy: "Weekly notes from the AcreOS founder. What we're building, what customers are telling us, and what we're learning along the way." File comment line 1–7 frames it as "Diego's founder-led community as the SMB acquisition flywheel."
- `client/src/pages/letter-detail.tsx` (102 lines) — single-letter view at `/letters/:slug`. Metadata fallback string: "A founder letter from AcreOS."
- These two files render content out of `/api/letters` and `/api/letters/:slug`.

### 1.2 The contradiction

- Voice doctrine (`00-blueprint.md` §2): no founder voice on customer surfaces.
- `/letters` is a customer surface (unauthenticated, linked from landing — per the existing `utm_source=letters` link in `letters-archive.tsx` line 47).
- Header copy explicitly invokes "the AcreOS founder."
- Per `feedback_landing_voice`: mechanics-first third-person; remove founder-letter tone.
- Per the `00-blueprint.md` discipline locks: "No founder name in customer-facing materials" and "No founder voice on customer surfaces."

These are in direct conflict. The `/letters` surface as currently framed cannot pass voice doctrine.

### 1.3 Options for resolution (Tom decides — see §C of report-back)

**Option A — Retire `/letters` entirely.**
- Remove the route, archive the database table to a private view, redirect `/letters` and `/letters/:slug` to `/learn` (since `/learn` is the editorial replacement under the new blueprint).
- Pros: zero ambiguity; doctrine clean.
- Cons: loses any SEO equity already accumulated by the existing letters; loses the surface that has historical content.

**Option B — Rebrand `/letters` to "Field Notes," shift voice.**
- Rename to `/field-notes` (with 301 from `/letters`). Reframe as third-person operator-facing notes: "Field notes — what AcreOS shipped, what the data showed, what's next." Existing letter content remains accessible but new pieces follow doctrine. Header copy + metadata + senderEmail handling refactored.
- Pros: preserves SEO + history; aligns voice; the format (periodic dispatches) still works.
- Cons: edit cost for historical pieces (or accept that older pieces are voice-grandfathered with a banner).

**Option C — Keep `/letters` as-is and carve it out of voice doctrine.**
- Declare `/letters` an explicit doctrine exception, on the basis that "founder letters" is a known genre and signals authenticity.
- Pros: zero refactor; preserves voice character.
- Cons: doctrine has a hole; the founder-name rule then must also carve out; the linter has a route-level exception; introduces drift over time.

**Soren's recommendation: Option B.** Preserves equity, aligns doctrine, gives the surface a defensible long-arc identity. The genre survives; the voice updates.

---

## 2. Landing chip taxonomy honesty audit

### 2.1 What ships today

`client/src/pages/landing/copy.ts` lines 56–86 declare the positioning block. The truth-engine comments (lines 58–81) cross-reference `shared/business-types.ts`. Per the comment annotation:

- **Core:** land investors (primary), note investors. Full workflow templates exist. **Matches** `shared/business-types.ts`: `land_flipper` (core), `note_investor` (core), `hybrid` (core).
- **Beta:** fix-and-flippers, wholesalers, tax-delinquent buyers. **Matches** registry: `fix_and_flip` (beta), `residential_wholesaler` (beta), `tax_lien_deed` (beta). Also `creative_finance` (beta) in registry — landing comment does not name it. **Drift item 1.**
- **Roadmap (landing):** subdividers, buy-and-hold landlords. Registry has `subdivider` as **beta**, not roadmap. The landing comment explicitly notes: "Subdividers ... demoted to roadmap on landing for honesty." **Drift item 2** — the landing intentionally demotes; the registry is more permissive. This is honest in the customer's favor (the registry says beta, the customer-facing chip says roadmap, so the customer expects less than the product delivers — safe).
- **Roadmap (rest):** `short_term_rental`, `commercial`, `developer`, `multifamily`, `mobile_home`, `agent_investor` are all roadmap in registry — these are not named on landing at all. **Acceptable** per blueprint §1.3 ("disclose but don't amplify" — naming is optional for roadmap-only).

### 2.2 Findings

1. **`creative_finance` is beta in the registry but unnamed on the landing.** Either name it as beta in the positioning band OR demote it to roadmap in the registry. Recommend: name it on the landing — the workflow vocabulary already exists per the registry's `spotlightModules: ["notes", "deals"]`.

2. **`subdivider` is beta in the registry but framed as roadmap on the landing — intentionally.** Defensible. Keep until subdivider work matures (per `00-blueprint.md` Phase 1 maturation arc).

3. **`buy_and_hold` is roadmap in the registry and framed as roadmap on the landing — honest.** No action.

4. **The landing copy.ts positioning block uses prose; the actual chip rendering is in `client/src/components/landing/Positioning.tsx`** (per the comment reference). Verify that file enforces the same tier split visually. Not read in this round; flag for W1-4 audit task.

### 2.3 Recommendation

Add `creative_finance` to the beta-named list in `LANDING_COPY.positioning.inProduct`. One-word delta: "Fix-and-flippers, wholesalers, **creative-finance operators**, and tax-delinquent buyers are in beta."

This is a Week-2 ship per `04-90-day-execution.md` W2-1.

---

## 3. Truth-engine status — is it actually running?

### 3.1 What the landing comments claim

`client/src/pages/landing/copy.ts` lines 24–31:

> Truth-engine notes (2026-05-31):
>   - "14 comps per parcel" removed from hero sub; engine caps at 25 ...
>   - "90 seconds" for buy-box filtering and Pax reply drafts retained — these are system latency targets baked into the job queue.
>   - "10 minutes" for first list retained — setup time, not processing.

This is **truth-engine evidence as comment, not as enforced code.** The claims have been audited once (2026-05-31) by a human. There is no automated guard against re-introducing an indefensible number.

### 3.2 Status

- **Truth-engine as discipline: live.** A human reviewed and removed an indefensible claim. The other claims have pointers in prose form.
- **Truth-engine as code: not running.** No `truth-sources.ts` file. No linter. No CI gate. Future drift is not prevented.
- **The `02-voice-linter.md` spec §3.4 + §3.5 fills this gap** — when shipped (W9-1), the linter enforces numeric-claim provenance against a registry file.

### 3.3 Recommendation

Ship the truth-source registry file in W4-1 (separate from the linter). Even without the linter, having the registry makes future audits 10x faster and makes the linter's W9-1 ship trivial.

---

## 4. Programmatic SEO present state

- 10 pages live (`find /Users/user/AcreOS/AcreOS/content/learn -name "*.json" | wc -l` = 10 as of 2026-06-05).
- 2 verticals × 5 states each (per `client/src/pages/learn/registry.ts` glob).
- Schema lacks: `facts` provenance array, `freshnessRule`, structured `relatedPages`.
- Hosted via Vite glob — every page bundled into the SPA at build time. Viable at 10 pages; not viable at scale per `01-content-engine.md` §4.

**Verdict:** the foundation is correct; the schema needs the §2.2 upgrade; the stack needs the §4 migration before Phase 2.

---

## 5. Honest assessment summary

| Area | Honest state | Risk | Severity |
|---|---|---|---|
| Landing copy voice | Mostly doctrine-aligned; one drift item (`creative_finance` unnamed) | Customer sees incomplete vertical map | Low |
| `/letters` surface | Voice-doctrine violation in framing | Doctrine has a hole; can't ship the linter without an exception | High — Tom decision needed |
| Truth engine | Discipline live; code not | Future copy drift unprotected | Medium |
| Programmatic SEO | Foundation correct, schema thin, stack non-scalable | Cannot grow past ~500 pages on current stack | Medium |
| Voice linter | Not built | Drift accumulates between human audits | Medium |
| Analytics | No `marketing_touch`; UTM lost at auth | All Phase-0 acquisition data is un-attributable | High |
| Newsletter / owned audience | None | No second-touch path beyond search | Medium |
| Outreach | None | Cold acquisition surface is search-dependent | Medium |

The two **High** items — `/letters` voice contradiction + analytics substrate missing — are the two W1–W6 work items the blueprint prioritizes.
