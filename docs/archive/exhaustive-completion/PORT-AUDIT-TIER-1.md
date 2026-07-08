# Tier 1 Self-Audit — Daily-Driver Pipeline Core

Gate per founder requirement: walk Tier 1 surfaces against the design brief
sections (voice, visual baseline, density, motion, component grammar, AI
agent presence). Flag drift. Fix critical drift. Document findings before
proceeding to Tier 2-5.

## Surfaces audited

| Surface | Commit | Status |
|---|---|---|
| `/today` (Command Center) | `9a5d631` | Ported |
| `/pipeline` | `b7b0dd8` | Ported |
| `/parcels/:id` | n/a | Deferred (JUDGMENT-CALLS E.2.3.1 — no production analog) |
| `/inbox` | `b7b0dd8` | Ported (Pax-draft feature deferred per JUDGMENT-CALLS E.2.4.1) |

## Audit method

Walk each surface in the production codebase against the design-system
sections enumerated in the founder's E.2 directive. Static-only audit
(live screenshots gate after deploy + Phase F capture).

## Section 1 — Voice (design-system §1)

**Test:** Could each user-visible string live in the same document as the
founder letter?

| Surface | String / Pattern | Pass? | Notes |
|---|---|---|---|
| /today | "Good morning, Thomas. 3 deals need attention today." | ✅ | Matches prototype voice exactly. Specific over vague. |
| /today | "Welcome back! It's been 3 days since your last visit." | ✅ | Plain language, specific. |
| /today | "Pax noticed" / "Pax suggests" section headers | ✅ | Subtle agent attribution per §1.3. |
| /today | "All caught up! No priority actions right now." | ⚠️ | Cutesy register; "All caught up" is borderline but acceptable. Flag for Phase G polish refinement to e.g. "Nothing pressing today." |
| /today | "Welcome to AcreOS!" onboarding banner | ⚠️ | Trailing exclamation point lands at "cutesy" register. Phase G polish: drop the exclamation. |
| /today | "Ready to find your first deal?" empty state | ✅ | Specific question; no hype language. |
| /pipeline | "active deals · in flight" header | ✅ | Editorial register matches prototype. |
| /pipeline | "14+ days idle" stalled tile | ✅ | Specific, plain. |
| /inbox | Reply textarea placeholder "Type your reply…" | ✅ | Plain. |
| /inbox | "Your draft is preserved. Try again or check the email provider status." error toast | ✅ | Specific blame attribution per design-system §11 error voice. |

**Verdict:** Voice passes broadly. Two cutesy/exclamation residuals flagged
for Phase G polish — not Tier 1 blockers.

## Section 2 — Visual baseline (design-system §2)

**Test:** Restraint and craft. Calm dominates. Per-theme switching works.

| Surface | Element | Pass? | Notes |
|---|---|---|---|
| /today | Hero greeting using `acr-cc-greeting` (Fraunces 32px/600) | ✅ | Matches prototype editorial register. |
| /today | `acr-cc-metrics` 5-up grid | ✅ | Card with subtle border + level-1 shadow per prototype. |
| /today | "Welcome Back" gradient (`from-blue-50 to-indigo-50`) | ❌ | Hardcoded blue — does NOT switch with theme. Flagged for Phase G polish (uses bg-gradient-to-br across all themes, breaks calm register on Quarry/Nocturne). |
| /today | Pulse score bar conditional `bg-emerald-500/bg-amber-500/bg-blue-500` | ❌ | Hardcoded — flagged for Phase G polish to use --acr-pos/warn/accent. |
| /today | Hot deals tile (`text-orange-500`) | ❌ | Hardcoded. Flagged for Phase G polish. |
| /today | "Start here today" Zap icon (`text-amber-500`) | ❌ | Hardcoded. Flagged for Phase G polish. |
| /today | Pax noticed cards (post-E.2.1) | ✅ | Now using --acr-neg/warn/accent semantic tones. |
| /pipeline | Velocity tiles (post-E.2.2) | ✅ | All five tiles now using --acr-* semantic tokens. |
| /inbox | Reply Card (post-E.2.4) | ✅ | rounded-card radius applied. |

**Verdict:** Critical Pax/agent surfaces re-skinned. Several remaining
inline color hardcodes on /today flagged for Phase G polish (the surface
gets dedicated polish-pass attention per design-system §14). Tier 1 does
NOT block on full color cleanup since the brief explicitly schedules
/today for Phase G dedicated polish.

## Section 2.1 — Density (design-system §6.1)

**Test:** Surface defaults match §5.5 table. User can override via Settings.

| Surface | Default | User-toggleable? | Pass? |
|---|---|---|---|
| /today | comfortable | n/a | ✅ |
| /pipeline | adaptive (cards default in kanban view) | yes (via useListView) | ✅ — Phase C.3 list-view preferences will apply when /pipeline starts consuming `useListView("pipeline")` (deferred to Phase E.9 wire-as-port) |
| /inbox | comfortable, rows | yes | ✅ — same wire-on-port pattern |

**Verdict:** Density defaults correct. Per-list-type user override surfaces
are wired in Settings → Appearance (Phase C.3); per-surface consumption
lands as Phase E.9 deferred work.

## Section 2.2 — Motion (design-system §6.2)

**Test:** 150-250ms transitions, native easing, no ambient motion. Reduced
motion honored.

| Surface | Element | Pass? |
|---|---|---|
| All Tier 1 | `transition-shadow` on cards (default ~150ms) | ✅ |
| All Tier 1 | `--acr-dur-fast/normal/slow` available via index.css | ✅ |
| All Tier 1 | `[data-motion="reduced"]` collapses durations to ≤60ms | ✅ — set via theme-context.tsx + CSS rule |
| /today | `AnimatedCounter` for autonomy score | ✅ — purpose: clarity (number transitions). Acceptable per brief. |
| /today | No parallax, no auto-rotating, no scroll-jacking | ✅ |

**Verdict:** Motion passes.

## Section 5 — Component grammar (design-system §5)

**Test:** Buttons, cards, pills consistent. Outline icons by default. Single
icon family.

| Surface | Element | Pass? | Notes |
|---|---|---|---|
| All Tier 1 | shadcn `Button` primitive used throughout | ✅ | |
| All Tier 1 | shadcn `Card` primitive used throughout | ✅ | |
| All Tier 1 | shadcn `Badge` primitive used as Pill analog | ✅ | |
| All Tier 1 | Lucide React icons (single family) | ✅ | |
| /today | Card radius — mix of default `rounded-lg` and `rounded-card` | ⚠️ | Flagged for Phase G polish — global Card primitive could default to `rounded-card`, vs requiring per-card opt-in. Not blocking. |
| All Tier 1 | Focus rings via Tailwind `ring-ring` (HSL ring token) | ✅ | Theme-aware. |

**Verdict:** Grammar passes. Card-radius opt-in pattern documented as
Phase G polish opportunity.

## Section 1.3 — AI agent presence (design-system §1.3)

**Test:** Subtle named-agent attribution. Atlas/Pax/Sophie quiet bylines.
Honesty rule (show what / what sources / how confident / what skipped).
One-click pause/edit/override.

| Surface | Element | Pass? | Notes |
|---|---|---|---|
| /today | "Pax noticed" section header (post-E.2.1) | ✅ | Section header IS the byline. |
| /today | "Pax suggests" section header (post-E.2.1) | ✅ | Same pattern. |
| /today | Generic "AI" badges removed | ✅ | E.2.1 cleanup. |
| /today | Agent activity surface (sovereign system status) | ✅ | Existing surface; shows active agent count. |
| /today | "Confidence" / "Sources" attribution on Pax suggestions | ⚠️ | Existing render shows priority badge but NOT confidence/sources/skipped. Brief §1.3: "every agent shows what it did, what it used, how confident it is, what it skipped." Flagged as Pax-detail follow-up (post-port feature). |
| /inbox | Pax-drafted reply card | ❌ | Production lacks the Pax-draft-then-edit flow. Logged JUDGMENT-CALLS E.2.4.1. |

**Verdict:** Top-level agent attribution clean. Confidence + source
transparency on individual Pax outputs is a deferred follow-up — feature
add, not a Tier 1 blocker. Tracked.

## Section 11 — State coverage (design-system §11)

**Test:** Loading, empty-zero, empty-filtered, error states present.

| Surface | Loading | Empty-zero | Empty-filtered | Error | Pass? |
|---|---|---|---|---|---|
| /today | ✅ Skeleton stripes per section | ✅ "All caught up" + GettingStartedChecklist for new orgs | ⚠️ Limited | ⚠️ Top-level error boundary, no per-section recovery | Mostly |
| /pipeline | ✅ via Tabs lazy + page-shell skeleton | ✅ FunnelStages with 0 counts gracefully | ⚠️ | ⚠️ Top-level boundary | Mostly |
| /inbox | ✅ Skeleton on thread list + message body | ✅ "Inbox is empty" pattern | ✅ Filter + folder shows zero | ✅ Toast on send/archive failures | Yes |

**Verdict:** Loading + empty-zero pass everywhere. Empty-filtered and
recoverable error states are the most uneven. Phase E.8 (per-surface state
matrix) fills the gaps with QueryErrorState patterns.

## Critical drift fixed during audit

None. The pre-audit edits in commits `9a5d631` (today.tsx Pax sections)
and `b7b0dd8` (pipeline velocity + inbox reply card) addressed the most
visible color-hardcode and missing-byline issues. Remaining drift
(/today Welcome Back gradient, Pulse score bar, hot-deals icon color,
"Start here today" amber tint) is documented for Phase G polish where
/today is one of the six dedicated polish surfaces (design-system §14).

## Tier 1 → Tier 2-5 gate decision

**Pass.** Tier 1 surfaces:
- Match prototype voice broadly (two cutesy residuals flagged but not
  blocking)
- Use --acr-* semantic tones for primary status indicators
- Have agent attribution via section headers (not generic "AI" badges)
- Include adequate state coverage for the daily-driver loop

Patterns established in Tier 1 that Tier 2-5 should inherit:
1. **Severity → semantic token mapping**: high/destructive → --acr-neg,
   medium/warning → --acr-warn, low/positive → --acr-pos, value/info →
   --acr-accent. Use `text-acr-X`, `bg-acr-X-soft`, `border-[color:var(--acr-X)]/30`.
2. **Agent attribution in section headers, not in badges**. "Atlas
   noticed" / "Pax suggests" / "Sophie flagged" — header IS the byline.
3. **rounded-card (14px) for cardish surfaces**, not rounded-lg.
4. **Per-list-type defaults** registered in `LIST_VIEW_DEFAULTS` (use-list-view.ts);
   per-surface render uses `useListView(listType)` to apply user override
   (deferred wire-as-port).
5. **data-tour="X" anchors preserved** even when underlying functionality
   isn't yet ported.
6. **Inline TODO comments** at exact mount points for deferred functional
   features (e.g. inbox Pax-draft).
7. **Color hardcodes on tertiary/decorative elements** (illustrations,
   onboarding banners, gradients) deferred to Phase G polish — avoid
   touching during Tier 2-5 unless they fail the brief's tests directly.

## Carryforward items (tracked but not blocking)

These items get touched in Phase G polish:
- /today Welcome Back gradient (hardcoded blue)
- /today Pulse score bar conditional (emerald/amber/blue)
- /today "Start here today" Zap icon (text-amber-500)
- /today hot-deals icon (text-orange-500)
- /today onboarding banner exclamation point
- "All caught up!" cutesy residuals
- Card radius default migration (rounded-lg → rounded-card platform-wide)

These items get touched in Phase E.9 deferred wires:
- /pipeline `useListView("pipeline")` consumption
- /inbox `useListView("inbox")` consumption
- Pax-draft pre-fill (post-port feature add)
- Confidence/source transparency on Pax outputs

## Proceeding to Tier 2

Tier 2 (sourcing): /buyboxes, /lists, /campaigns, /campaigns/performance.
Apply Tier 1 patterns (semantic tones, agent attribution in headers,
rounded-card, data-tour preservation). E.3 begins next.
