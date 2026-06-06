# First 90-day execution plan

**Companion to:** `00-blueprint.md`, `01-content-engine.md`, `02-voice-linter.md`, `03-analytics.md`
**Owner:** Soren
**Status:** Plan. Execution begins once Tom signs off on the decisions surfaced in §C of the report-back.

---

## Conventions

Each item declares:

- **What ships** — concrete artifact or behavior
- **Owner** — Soren | Iris-handoff | Beatrice-review | Solene-approve
- **Discipline bar** — what "done" looks like (verifiable, not aspirational)
- **Expected metric movement** — what should measurably change

---

## Week 1 — Substrate locks (foundation only; no public-facing changes)

### W1-1 — Voice doctrine published internally
- **Owner:** Soren
- **What ships:** `docs/internal/marketing-os/00-blueprint.md` §2 declared the authoritative voice doctrine. Linked in `CLAUDE.md` under a new "Marketing voice" section.
- **Discipline bar:** Any future agent (or human) writing customer-facing copy references it; deviations require a written exception in the PR description.
- **Expected metric:** Zero — substrate.

### W1-2 — Category positioning declared internally
- **Owner:** Soren + Solene-approve
- **What ships:** "Land Operating System" locked as the canonical category in `00-blueprint.md` §1. Internal team alignment confirmed.
- **Discipline bar:** Solene confirms; Maren (when phase-1 active) acknowledges; Tom signs off in the report-back.
- **Expected metric:** Zero — substrate.

### W1-3 — Landing page voice audit against doctrine
- **Owner:** Soren
- **What ships:** Read-through of `client/src/pages/landing/copy.ts` against §2 voice doctrine. Findings logged. Diffs proposed but NOT shipped this round (planning-only directive).
- **Discipline bar:** Every block in `LANDING_COPY` either passes doctrine or has an explicit deviation note.
- **Expected metric:** Zero this round; sets baseline for Week 2 ship.

### W1-4 — Chip taxonomy honesty audit
- **Owner:** Soren
- **What ships:** Cross-check the positioning band chips in `client/src/components/landing/Positioning.tsx` (referenced from `copy.ts` comment) against `shared/business-types.ts`. Document any drift in `05-current-state.md` §2.
- **Discipline bar:** For each of the 15 vertical IDs, the landing's tier matches the registry's `maturity` field. Any mismatch is logged.
- **Expected metric:** Zero — substrate.

---

## Weeks 2–4 — First content + first outreach

### W2-1 — Voice-doctrine landing-page conformance ship
- **Owner:** Iris-handoff (code change), Soren-approve (copy change)
- **What ships:** Doctrine-aligned edits to `client/src/pages/landing/copy.ts`. The `LANDING_COPY` constant is the only edit surface. No new files.
- **Discipline bar:** Diff reviewed by Solene; truth-engine pointers added inline for every numeric claim per `02-voice-linter.md` §3.4.
- **Expected metric:** Bounce rate baseline locked (PostHog wired in W6).

### W2-2 — First four editorial pieces drafted
- **Owner:** Soren
- **What ships:** 4 editorial briefs filled (template per `01-content-engine.md` §5), then 4 posts drafted at 600–1,200 words each. Highest-leverage cells per `01-content-engine.md` §3.5:
  1. "Land flipper × Run the comps × MOFU"
  2. "Note investor × Service the note × MOFU"
  3. "Land flipper × Define the buy-box × TOFU"
  4. "Land flipper × Send the mail × TOFU"
- **Discipline bar:** Each piece passes the §2 voice doctrine read; each numeric claim has a `// source:` pointer; each piece is briefed before drafted.
- **Expected metric:** 4 indexable surfaces added; organic-traffic baseline established.

### W3-1 — Programmatic SEO prototype (3–5 pages)
- **Owner:** Soren-author + Iris-handoff (registry extension)
- **What ships:** 3 new programmatic pages added to `content/learn/`: land-flipping × {California, Florida, Arizona}. Schema upgraded to include `facts`, `freshnessRule`, `relatedPages` per `01-content-engine.md` §2.2. Existing 10 pages backfilled with the new fields.
- **Discipline bar:** Each page has ≥3 sourced facts, FAQ schema.org markup, ≥4 internal cross-links.
- **Expected metric:** 13 → 13 indexable pages (count same; depth doubled).

### W3-2 — First outreach sequence drafted (not sent)
- **Owner:** Soren + Beatrice-review (compliance)
- **What ships:** Cold-outreach sequence draft to land investors sourced from public investor-association directories. 5 emails over 21 days. Mechanics-first; no founder voice; no investment-return language.
- **Discipline bar:** Beatrice reviews CAN-SPAM + state UCE compliance; voice doctrine pass; deliverability baseline acknowledged (per `docs/internal/email-deliverability-baseline.md`).
- **Expected metric:** Zero this period (drafted, not sent).

### W4-1 — Truth-source registry file created
- **Owner:** Soren + Iris-handoff
- **What ships:** `client/src/pages/landing/truth-sources.ts` (or equivalent) with the registry per `02-voice-linter.md` §3.5. Wired into `copy.ts` (or referenced via comment until linter exists).
- **Discipline bar:** Every numeric claim currently in `LANDING_COPY` has a row.
- **Expected metric:** Zero — substrate.

---

## Weeks 5–8 — Cadence lock + first owned audience

### W5-1 — Editorial cadence locked at 1/week
- **Owner:** Soren
- **What ships:** Recurring calendar entry; 8 weeks of briefs queued ahead of publish.
- **Discipline bar:** Briefs exist for the next 4 weeks at all times (rolling window).
- **Expected metric:** Predictable publish rhythm.

### W5-2 — Programmatic SEO to 50 pages
- **Owner:** Soren-author + Iris-handoff
- **What ships:** 37 net-new programmatic pages. Vertical × state matrix: land-flipping + note-investing × top 25 states by parcel volume.
- **Discipline bar:** Each page hits the §2.3 on-page-elements checklist. Each page reviewed by Soren before publish.
- **Expected metric:** Indexed-page count → 60+. Search Console impressions baseline rising.

### W6-1 — Analytics substrate wired (Phase 0 cut)
- **Owner:** Iris-handoff per `03-analytics.md`
- **What ships:** `marketing_touch` table migration; `anonymousId` cookie set; PostHog cloud SDK wired; UTM-survival fix at auth handshake.
- **Discipline bar:** Test signup path: land on `/?utm_source=test&utm_campaign=spec` → signup → `signups.attribution.firstTouchUtm` reflects `test/spec`.
- **Expected metric:** Attribution chain integrity = 100% on new signups.

### W6-2 — Owned-audience signup mechanic
- **Owner:** Soren + Iris-handoff
- **What ships:** Footer-band email-capture form on `/learn` and `/letters`. Single field, no popup, no exit-intent. "Get the AcreOS field log — weekly, no fluff."
- **Discipline bar:** Doctrine-compliant copy; CAN-SPAM compliant footer on every send; double opt-in.
- **Expected metric:** Newsletter list ≥ 50 by end of Phase 0.

### W7-1 — First cohort report
- **Owner:** Soren
- **What ships:** Manual report from PostHog + Postgres `marketing_artifact_economics` view: signups by source, trial→paid by source, top 3 artifacts by attributed signups.
- **Discipline bar:** Single page; sent to Solene + Tom.
- **Expected metric:** First defensible baseline for blended CAC.

### W8-1 — First outreach sequence sent
- **Owner:** Soren + Beatrice-review
- **What ships:** The W3-2 sequence sent to a pilot of 100 prospects.
- **Discipline bar:** Reply rate tracked; unsubscribe rate ≤2%; deliverability metrics within baseline.
- **Expected metric:** ≥3 booked demos OR signups attributable to the pilot.

---

## Weeks 9–12 — Linter + A/B + cohort discipline

### W9-1 — Voice linter shipped
- **Owner:** Iris (per `02-voice-linter.md` §5)
- **What ships:** `scripts/lint-voice.ts` + initial rule set + pre-commit + CI workflow.
- **Discipline bar:** Catches the 4 forbidden-token rules + the 4 voice-pattern rules + the numeric-claim-provenance rule. Tested against a known-bad fixture.
- **Expected metric:** Zero voice drift on shipped PRs after this date.

### W10-1 — A/B framework spec'd
- **Owner:** Soren-spec → Iris-implementation
- **What ships:** Spec doc `docs/internal/marketing-os/06-ab-framework.md` covering: experiment registration, sample-size calc, primary-metric pre-declaration, sequential-testing guard against p-hacking.
- **Discipline bar:** Spec passes Beatrice review (no dark-pattern paths).
- **Expected metric:** Zero this period (spec only).

### W10-2 — Programmatic SEO at 250 pages
- **Owner:** Soren-author + Iris-handoff
- **What ships:** Vertical × state matrix extended; first county-level pages prototyped (10 counties in Texas).
- **Discipline bar:** Same §2.3 checklist; freshness rules declared per page.
- **Expected metric:** Indexed-page count 250+. Search Console clicks ≥ 100/day baseline.

### W11-1 — Phase-1 channel readiness assessment
- **Owner:** Soren + Solene-approve
- **What ships:** Memo: "Are we ready to spend $200/mo at Phase 1?" Includes: lifecycle email infra status, SEO tool subscription proposal, LinkedIn ad experiment plan.
- **Discipline bar:** Each proposed spend has CAC-payback ceiling declared.
- **Expected metric:** Phase-1 budget either authorized or deferred with reasons.

### W12-1 — 90-day retrospective
- **Owner:** Soren + Solene-approve
- **What ships:** Single doc: what shipped, what slipped, what's the next 90.
- **Discipline bar:** Honest. No founder-voice. Cite the analytics substrate.
- **Expected metric:** Sets next 90's plan.

---

## Cross-cutting disciplines (apply to every item)

1. **Voice-doctrine pass** before any copy ships.
2. **Truth-engine pointer** for every numeric claim.
3. **Beatrice review** for any send/publish that goes to a third party.
4. **Solene approval** for Phase-budget commitments.
5. **No founder voice on customer surfaces.** Period.
