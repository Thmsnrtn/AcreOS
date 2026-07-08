# Refinement Synthesis

Three parallel audits ran against the post-port platform:
- [`audit-founder-ops.md`](audit-founder-ops.md) — founder daily-ops lens (28 findings)
- [`audit-mobile-parity.md`](audit-mobile-parity.md) — 375×812 touch-only lens (~50 findings)
- [`audit-prototype-fidelity.md`](audit-prototype-fidelity.md) — production-vs-prototype + brief-mapping (60 findings)

This doc synthesizes them into **cross-cutting themes** (where 2+ audits hit
the same root cause), a **fix sequence** by leverage, and a **mechanical-vs-
product split**. Three audits found ~138 distinct items; this doc surfaces
the ~20 that span audits or unlock wide impact.

---

## Cross-cutting themes (root causes spanning audits)

### Theme 1 — Token discipline broke at the chrome layer
**Findings:**
- Card default `rounded-2xl` (24px) overrides brief §0.2 (`rounded-card` 14px) — touches every page (prototype #1)
- Theme-blind raw Tailwind tones at scale: onboarding-v2 (121), properties (45), deals (43), portfolio (35), settings (34), finance (23), today (14) (prototype #7)
- Recharts hardcoded `#3b82f6` / `#10b981` — chart palette never reads `--acr-chart-*` (prototype #9)
- `desert-gradient` in `index.css:1007` is theme-blind — Homestead HSL renders behind every page in Quarry/Nocturne/Meadow/Slate (prototype #5)
- Onboarding-v2 dynamic Tailwind `bg-${color}-950/20` not safelisted → cards render uncolored (mobile #5)

**Root cause:** The 5-theme tokens shipped, but the *defaults* on shared
primitives (Card, Recharts wrappers, gradients) and the on-demand class
generation patterns (dynamic strings) bypass tokens entirely. Every surface
inherits the wrong baseline.

**Single-file leverage:** `card.tsx` + chart-color tokens + desert-gradient
migration + safelist or static-class refactor for onboarding cards.

### Theme 2 — Mobile chrome doesn't account for itself
**Findings:**
- PageShell uses `pb-8` only; bottom card on every Tier 1 page hidden under MobileBottomNav (mobile #1)
- FAB collides with bottom-nav at iPhone home-indicator: 10px gap, both `z-50` (mobile #2)
- Inbox reply Send button hidden behind bottom nav (mobile #3)
- The `mobile-safe-content` utility already exists in `index.css:1093` — applied nowhere

**Root cause:** Bottom-fixed UI was added incrementally; PageShell wasn't
updated to clear it. Existing utility is the right fix, just unused.

**Single-file leverage:** Apply `mobile-safe-content` in PageShell + revisit
floating-slots vertical math against home-indicator height.

### Theme 3 — Persona architecture has visible leaks
**Findings:**
- `/pax` "Agents" tab exposes Atlas/Sophie/Forge to customers (prototype #4) — **violates the persona-architecture standing rule** (memory: "customers see Pax only; founder sees Sophie/Forge/Atlas/etc. Never mix")
- `/auth` tagline + meta description use "AI-powered" — brief §1.2 anti-pattern, first thing every signing-in user reads (prototype #3)
- Onboarding-v2 ships brief §13 anti-patterns directly: confetti + 8-color burst + `PartyPopper` icon + "The Most Intelligent Land Investing Platform" badge (prototype #2)

**Root cause:** Persona/voice surface review wasn't run end-to-end after the
internal agent infrastructure shipped — internal codenames bled into customer
surfaces, and brief-forbidden patterns survived port-time triage.

**Single-file leverage:** /pax tab visibility gate + /auth copy + onboarding-v2 anti-pattern deletion are 3 small files.

### Theme 4 — Decision infrastructure exists but isn't wired to the costliest surfaces
**Findings:**
- `/founder/todo` queues work from 7 sources without consulting `confidenceCascadeV14` to pre-resolve (founder #1)
- `/founder/strategy` shows raw weekly proposals alongside synthesis — no auto-defer/promote (founder #2)
- `/founder/prompt-evolutions` treats every diff equally — no canary-outcome auto-promote (founder #3)
- `/founder/onboarding` rescues are diagnostic only — Sophie should outreach first (founder #6)
- `/founder/expansion` requires founder approval per upsell — Forge could auto-fire on score ≥ 80 (founder #7)
- `/founder-home` shows hardcoded zero NPS and churn (API doesn't return them — admitted in code comment)

**Root cause:** v14 cascade/feedback/autonomy services shipped during port
but the surfaces founders use most still hit raw queues. Infrastructure is
upstream; surfaces are downstream and didn't get the wiring.

**Biggest single-day leverage of any finding in any audit.** Wiring
`confidenceCascadeV14` + `feedbackLoopV14.getOverrideAnalytics` into the
`/api/founder/intelligence/todo` endpoint as a pre-render filter unlocks
gaps 1, 2, 3, 6, 7 as configuration.

### Theme 5 — Brief-forbidden content shipped past triage
**Findings:**
- "Something went wrong" appears in 8+ surfaces — brief §11 explicitly forbids (prototype #8). Source: `query-error-state.tsx:77`
- "AI-powered" on /auth (prototype #3)
- "Most Intelligent Land Investing Platform" badge on /onboarding-v2 (prototype #2)
- 17-tab Settings horizontal-scrolling TabsList — Privacy/Security/Automations effectively unreachable on mobile (mobile #4)

**Root cause:** Brief §11 / §13 / §1.2 anti-patterns weren't enforced as a
discipline during the port — they exist as principles in the doc but no
guard runs against them.

---

## Top fixes by leverage

### Wave 1 — One-file mechanical (S effort each, all verifiable)

Total Wave 1: ~6 commits, ~1 focused day, each shippable with fix-and-verify
discipline (commit / deploy / curl-or-screenshot verify / next).

| # | Fix | File | Verification |
|---|-----|------|--------------|
| 1 | `Card` default radius `rounded-2xl` → `rounded-card` | `client/src/components/ui/card.tsx:16` | screenshot of any card-bearing surface |
| 2 | PageShell apply `mobile-safe-content` clearance | `client/src/components/page-shell.tsx:86` | screenshot of /today bottom + scroll on iPhone |
| 3 | `desert-gradient` HSL → token refs | `client/src/index.css:1007` | switch theme to Quarry, gradient should respond |
| 4 | "Something went wrong" → brief-voice copy | `client/src/components/query-error-state.tsx:77` | grep 0 occurrences post-fix |
| 5 | /auth "AI-powered" → brief-aligned tagline | auth page + meta tags | screenshot of /auth |
| 6 | /onboarding-v2 §13 anti-patterns deletion | confetti, PartyPopper icon, "Most Intelligent" badge | screenshot of onboarding wizard |

### Wave 2 — Bounded refactors (M effort each)

| # | Fix | Effort | Why it ranks here |
|---|-----|--------|-------------------|
| 7 | `ResponsiveModal` wrapper (Sheet on mobile, Dialog on md+) + replace 7+ Dialog instances | M | Single fix collapses ~7 mobile-painful findings |
| 8 | Recharts chart palette: define `--acr-chart-a..e` tokens, migrate consumers | M | Charts are theme-blind across portfolio/finance/pipeline |
| 9 | /pax persona-leak fix: hide Atlas/Sophie/Forge tab from customer view | M | **Persona-architecture violation; should ship soon** |
| 10 | `/founder/todo` cascade wiring | M | Single biggest founder-time leverage in any audit |

### Wave 3 — Product calls (need your decision before I touch)

| # | Decision | Why it's product not mechanical |
|---|----------|---------------------------------|
| 11 | Sidebar 58→14 items — which 44 get cut/grouped? | Affects every customer's mental model |
| 12 | Top-bar component — add (per prototype's `shell.jsx`) or skip? | Information-architecture call |
| 13 | Settings 17 tabs — restructure into ≤8 + jump menu, or accept as-is? | Affects every settings flow |
| 14 | Auto-promotion confidence thresholds (≥75/85/90?) | Risk tolerance + 14-day instrumentation question |
| 15 | Onboarding-v2 full redesign cadence (judgment call #3) | Schedule + reference-walkthrough commitment |
| 16 | founder-dashboard.tsx replace vs codemod (judgment call #2) | L vs S, depends on your appetite |

---

## Mechanical-vs-product split

**Mechanical (I can ship overnight with the discipline established):** all 6 Wave 1 items + arguably items 7, 8, 9 in Wave 2 if you authorize a longer session.

**Product (won't touch without your call):** all 6 Wave 3 items + the founder-todo cascade wiring (item 10), because confidence thresholds = risk tolerance.

---

## What this synthesis did NOT cover

- **Founder-dashboard.tsx (7435 lines)** — flagged as deferred polish in JUDGMENT-CALL-RECOMMENDATIONS #2; agents didn't line-pair-read it
- **Authenticated render quality** — still need a `storageState.json` from you to extend nav-audit coverage to the 154 protected routes
- **Command palette + Pax rail prototype comparison** — too large for the prototype-fidelity agent in one pass
- **Per-row tap-target heights** inside list-row components on mobile — needs rendered measurement, not static read
- **Real iOS keyboard behavior** in forms — needs device or simulator test
- **Charts / motion timing feel** — only structural review, not visual

---

## Proposed next move

If you authorize Wave 1, I ship 6 commits tonight with fix-and-verify discipline (commit individually, deploy individually, screenshot or curl verify, then next). Estimated ~3-4 hours including deploy waits. After Wave 1, you triage the 5 deferred coverage items above and the 6 Wave 3 product calls; Wave 2 + Wave 3 sequence based on your priorities.

Wave 1 is **~138 audit findings → 6 commits → wide impact via shared primitives + chrome utility**. That's the synthesis test passing: cross-audit pattern matching beats per-finding grinding.
