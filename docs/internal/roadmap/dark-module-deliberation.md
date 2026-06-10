# Dark-Module Team Deliberation — 2026-06-08

Tom's constraint: don't overload the system. **Default = KEEP DARK; a module must earn activation.** Whole-team lenses (Maren product-fit · Soren acquisition · Lena cost · Iris maintenance · Krieger nav/surface-area · Beatrice legal) applied to all 9 dormant feature-flagged modules. **No flags were flipped; no code modified — this is a recommendation memo.**

## Verdicts

| Module | Build reality | Verdict | Why |
|---|---|---|---|
| **Academy** | Backend skeleton; **frontend already deleted/"deprecated"** | **RETIRE** | Valuable half (edu content as SEO) already lives in `learn/`. In-app LMS duplicates it with ongoing LLM cost + skeleton routes. |
| **Deal Hunter** | Scrapers `return []` (non-functional); redirect-only | **RETIRE** | Superseded by the live `/deals/discover` (dealFeedEngine). A 2nd dead engine + a no-op scheduled job is pure liability + ToS/CFAA risk if ever made real. |
| **Tax Researcher** | Real shell, **fabricated data** (`Math.random()` invents foreclosure parcels + owner flags and **persists them as real listings**) | **RETIRE / quarantine** | Highest risk: a founder (who bypasses all flags) viewing it writes fake parcels to prod **now**. Different ICP (tax-lien). Zero disclaimers. |
| **Marketplace** | Production-shaped (809-line svc, live Stripe) | **KEEP DARK** | Worthless at zero liquidity; `note_securities`/`capital_raises` tables are securities-law-adjacent. Revisit at liquidity + Beatrice clearance. |
| **Capital Markets** | Polished UI over schema-mismatched model | **KEEP DARK** (hard-gate Beatrice) | `/securitize` + `/invest` create securities offerings with no accreditation/exemption/disclosure. Real SEC exposure. Never a flag-flip. |
| **Vision AI** | Core-fit but **broken** (retired `gpt-4-vision-preview`; live scanner stubbed) | **KEEP DARK** — #1 fix-later | Only one that's genuinely *core* (AI reading a parcel). Fix when a slot opens: migrate to a live vision model via `aiRouter`, implement the base64 entrypoint, add `properties.fieldScanData`, confidence framing. |
| **Land Credit** | Engine **already live everywhere** (deal feed, enrichment, preflight, portfolio cards) | **KEEP DARK** | The dark thing is a standalone `/land-credit` page = a redundant **6th door** violating the five-door nav. Engine already lit where it matters. |
| **Negotiation Copilot** | Best-built (1,007-line svc, real LLM, sessions) | **KEEP DARK** — best post-launch candidate | Genuinely new value at the margin-moment. Needs: per-org LLM caps (Lena), distressed-seller pressure-tactic guardrails (Beatrice), embed in Deals not a 6th door (Krieger). Activate when a real customer asks. |
| **Acquisition Radar** | Substantial 1,267-line scoring engine | **KEEP DARK** module — **adopt engine** | Standalone page stays retired, but the scorer is **stubbed out of the live feed** (`dealFeedEngine.ts:227` ships hardcoded `score: 50`). Wiring it in delivers all its value through the existing Deals door. |

## Net outcome
- **Activations: 0** (nav unchanged, no new live surface — your constraint held).
- **Retire: 3** — Academy, Deal Hunter, Tax Researcher.
- **Keep dark: 6** — with concrete, finite reactivation conditions recorded for each.

## Byproduct wiring wins (not module activations — value through existing surfaces)
1. 🟢 **Acquisition Radar scorer → deal feed** — fix the `dealFeedEngine.ts:227` stub so the live feed ranks by the real 1,267-line scorer instead of `score: 50`. Contained, high value, no new surface.
2. 🟢🚨 **Tax Researcher fabrication quarantine** — disable `generateMockAuctionData` / `generateMockDelinquentProperties` so it can NEVER persist `Math.random()` parcels. Urgent regardless of retire decision, because founders bypass the gate. (Moot if fully retired.)
3. ⏳ **Vision AI** fix-list (above) — when a build slot opens.

Awaiting founder sign-off on the 3 retirements before any deletion (hard-to-reverse).
