# Onboarding v2 — Redesign Plan

**Date:** 2026-05-04
**Workstream:** C.2 (per Comprehensive Pre-Vertical Stabilization Directive)
**Status:** **PLAN ONLY — awaiting founder approval before implementation.**

---

## What the prototype actually contains

`acreos-onboarding/screens-{1,2,3,4}.jsx` (992 lines total) — a real, substantial reference. Unlike `FounderHomeC`, this prototype is a full onboarding flow with:

| Screen | Source | What it does |
|---|---|---|
| Welcome | `screens-1.jsx::ScreenWelcome` | "Glad you're here" letter-style with three tone variants (`founder` / `plain` / `coach`) and density variants (`minimal` / `helpful` / `verbose`). Sets the workspace-arrival voice. |
| Markets | `screens-1.jsx::ScreenMarkets` | County selection on a US-map SVG, not a multi-select dropdown. Pick the counties you'll hunt parcels in. |
| Buy-Box | `screens-2.jsx::ScreenBuyBox` | Visual deal-glyph picker — terrain / acreage / price ranges captured as clickable shapes, not form fields. |
| Goals | `screens-2.jsx::ScreenGoals` | Monthly deal target. Tied to the buy-box for plausibility. |
| Phone | `screens-1.jsx::ScreenPhone` | Phone capture for SMS notifications. |
| Connections | `screens-2.jsx::ScreenConnections` | Provider connections (skip-trace, mail, e-sign). |
| Autonomy | `screens-2.jsx::ScreenAutonomy` | Per-agent autonomy slider. The 12-agent cockpit's "what can the agents do for you while you're not looking" decision. |
| Billing | `screens-1.jsx::ScreenBilling` | Plan + payment. |
| Reveal | `screens-1.jsx::ScreenReveal` | Workspace-arrival moment. "Here's your first list pulling overnight." |

**Plus shared scaffolding:**
- `OBRoadmap` — visible step indicator with time-per-step
- `OBCallout` — agent-specific tip surface ("Sophie says...")
- `OBPaxExplainer` — the unified-assistant explainer card
- `OBStepTime` — per-step time estimate
- Tone variants (founder / plain / coach) controllable per-org
- Density variants (minimal / helpful / verbose) controllable per-user

This is a real redesign reference. It's worth a 2-day session.

---

## What's currently shipping vs. what the prototype implies

`client/src/pages/onboarding-v2.tsx` (1,543 lines) — the current page.

| Aspect | Current | Prototype |
|---|---|---|
| Visual feel | Setup wizard | Workspace-arrival letter |
| Tone variants | None (one voice) | Three (founder / plain / coach) |
| Density variants | None | Three (minimal / helpful / verbose) |
| Markets picker | Multi-select dropdown | US-map SVG |
| Buy-box | Numeric form fields | Visual deal-glyph picker |
| Autonomy step | Per-agent toggle list | Per-agent slider with explainer |
| Reveal screen | Generic "you're done" | "Here's your list pulling overnight" |
| Note-investor fork | Step 0 added Wave 12 | Implicit — can be tone variant |
| Step roadmap | Linear progress bar | `OBRoadmap` with visible time-per-step |
| Voice | Functional | Walks-into-a-workspace |

The redesign is structural, not just visual.

---

## Constraints (from founder directive)

1. **Investor-type fork added in Wave 12 must be preserved.** Step 0 ("Land / Notes / Both") routes to either the land flow or the note-investor flow. The redesign can change the visual treatment of this step but cannot remove the branching logic.
2. **State persistence must stay intact.** `OnboardingWizard` persists progress to `organizations.onboarding*`. The redesign uses the same persistence shape; only the rendering layer changes.
3. **2 days of focused effort.** Founder-budgeted. Plan must fit.
4. **Note-investor onboarding screens must be redesigned to match.** Otherwise the fork creates two visual experiences.

---

## Plan

### Phase A — preparation (½ day)

1. **Inventory** the current `onboarding-v2.tsx` step list. Map each step to a prototype screen (most should map 1:1).
2. **Extract** any business logic that's tangled into the JSX (validation, persistence calls, side effects). Move to a `useOnboardingStep()` hook so the new visual shells can re-use it without rewriting.
3. **Set up** the redesign as `client/src/pages/onboarding-v3.tsx` (NEW file, NOT an in-place rewrite). Old page remains accessible at `/onboarding-v2-legacy` for a week.
4. **Feature flag** `onboarding_v3_enabled` — default OFF for everyone except the founder, who can verify against staging before flipping.

### Phase B — implementation (1 day)

For each step in the new file:

- Welcome — port `ScreenWelcome` JSX + the three tone variants. Default to `founder` tone for now; ship the registry but don't expose the picker yet.
- Markets — port `ScreenMarkets` + the US-map SVG. The SVG itself can be lifted from the prototype directly; there's no business logic in it.
- Buy-Box — port `ScreenBuyBox` + the deal glyphs. The glyphs are visual primitives that can be lifted directly.
- Goals — port `ScreenGoals` (light surface).
- Phone — port `ScreenPhone` (light surface).
- Connections — port `ScreenConnections`. This is the surface most likely to need adaptation since current AcreOS has different connector slots than the prototype assumed.
- Autonomy — port `ScreenAutonomy`. The slider model maps cleanly to the existing autonomy storage from migration 0030.
- Billing — port `ScreenBilling`. Stripe integration stays as-is.
- Reveal — port `ScreenReveal` + the "first list pulling overnight" framing.

**Investor-type fork:** Step 0 stays. Each branch (land / notes / both) gets its own welcome + buy-box variants but shares the rest of the screens. Note-investor variant uses the persona vocabulary registry from Wave 12.

### Phase C — verify (½ day)

- Headless screenshot pass: each screen × 5 themes × 2 modes × land/notes branches
- Manual walk-through: founder runs through the flow end-to-end on staging
- Persistence verify: confirm `organizations.onboarding*` columns get populated identically
- Wizard-save-state hook (Wave 11) verify: refresh mid-flow → state restored

### Phase D — cutover (½ day)

- Flip `onboarding_v3_enabled` to default ON
- New users → onboarding-v3
- `/onboarding-v2-legacy` accessible for one week
- Delete legacy after one week

### Total: 2 days

Tight. Plausible if Phase A is clean and the prototype JSX lifts cleanly into TS.

---

## What's out of scope

- Tone variant picker UI — registry ships, picker doesn't (keeps PR small; can add later)
- Density variant picker UI — same as above
- A/B harness for variants — separate workstream
- Reseller white-label adaptation — parked per Workstream E

---

## What this plan needs from you

**Authorize:**

- (1) **Approve the plan as-is** → I begin Phase A immediately.
- (2) **Approve with changes** → flag what to adjust; I revise and resubmit.
- (3) **Reject** → defer per JUDGMENT-CALL #3 alternative (incremental polish only).

**Decisions you may want to make ahead of implementation:**

- **Default tone variant?** I'll default to `founder` (most distinctive) but you could pick `plain` for breadth. Trivial to flip.
- **US-map SVG: lift directly from prototype, or rebuild against current parcel-county data?** Lifting is fast (1 hour), rebuilding is 4-6 hours but reflects current customer county coverage.
- **Note-investor variant copy:** the prototype doesn't have one. I can write a first draft from the Wave 12 persona vocabulary registry, but you may want to edit.

---

## Honest read on risk

The 2-day budget is achievable IF:
- The prototype JSX lifts cleanly to TS without major adaptation (60% confidence — there are obvious gotchas like `window.OBClarity` references that need migrating)
- The existing `OnboardingWizard.tsx` business logic separates cleanly from JSX (high confidence — it's been adapted before)
- No surprise state-persistence schema mismatches (medium confidence — the Wave 12 investor-type fork added complexity)

If any of those go sideways, expect 3 days. I'll flag at end of Phase A if the budget is at risk.

**Awaiting your call.**
