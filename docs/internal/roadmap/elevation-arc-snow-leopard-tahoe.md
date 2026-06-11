# Elevation Arc — Snow Leopard → Tahoe

> Living roadmap. Tom 2026-06-11 (on Opus 4.8 1M-context): treat the current
> platform as an elementary "Snow Leopard" version and elevate it to a
> "Tahoe-class" product — refine to consistency first, then elevate the design
> language. Updated each wave. Definition of done = wired + alerted + measured +
> verified across viewports/themes/states/personas — never "looks done."

## Phase 0 — Census (this document)

Two read-only census agents ran 2026-06-11. The headline findings reframe the
whole arc:

### Finding 1 — Phase 1 (Snow Leopard / refine-to-consistency) is already done.
This was executed over the preceding session (Census Waves W1–W5 + reimaginings
3A–3F, see `git log` "T3 Census W*" / "T3-3*" and the prior census at
`t3-uiux-census-2026-06-10.md`). Verification:

- All **10 worst surfaces** are at-bar (borrower-portal, avm, negotiation-copilot,
  portfolio-optimizer, field-scout, settings, blind-offer-wizard,
  market-intelligence, support-content, landing.css hover) — Skeleton +
  QueryErrorState + EmptyState adopted; residual `animate-spin` are all correct
  `mutation.isPending` button spinners.
- All **23 D-grade surfaces** at-bar; no genuine D-grade stragglers remain (the
  W5 D-tail wave caught the last 8). The 11 sweep hits are decomposition
  false-positives or pre-existing C-grade lookup-tools never wave-scoped.
- **4 of 5 systemic issues RESOLVED + ENFORCED by ratchets** in the `check`
  chain: two-empty-state-systems (deleted, build-break-enforced), hardcoded-hex
  (`lint-page-hex`), iOS-hover (`lint-css-hover`), prefetch-authority
  (`lint-prefetch-authority`); plus `lint:ratchets` (console/req-as-any/
  res-status-raw/storage-linecount) and the contract-adoption up-ratchet.
- The **5th systemic issue (date-format) is RESOLVED but was the one unenforced
  gap** — 95 files on `lib/format.ts`, but ~30 files / 38 sites still used
  `toLocaleDate/TimeString` with no lint guarding regression.

**→ Action taken (this commit): added `lint:date-format` ratchet** (baseline
30 files / 38 sites, bidirectional, wired into `check`). Snow Leopard is now
**100% locked** — every consistency win is ratchet-enforced and can't regress.
Remaining: drive the date-format baseline 30→0 (a bounded migration sweep, the
first Phase-1.5 follow-up). The hex (6) and hover (17) baselines have the same
drive-to-zero tail; idiomatic.

### Finding 2 — The "no design system" premise was WRONG; a Tahoe kit already exists.
The design-language audit corrected the arc's framing. AcreOS is not
"functional-but-elementary." It is **"a Snow Leopard with a Tahoe-grade
materials kit already installed — applied unevenly and never enforced as one
switchable system."** Evidence:

- **A 544-line design spec exists**: `docs/design/SYSTEM-V1.md` ("Kai Brennan,
  Principal Designer," 2026-06-01) + an older `docs/unified-build/DESIGN-SYSTEM.md`.
- **A Tahoe/Liquid-Glass material kit is built**: `.glass-panel`/`.liquid-glass`
  (32px blur / 190% sat) with `::before`/`::after` specular + cursor-reactive
  highlight, `.floating-window` macOS elevation, macOS traffic-light dialogs
  (`index.css:1270–1336`).
- **Six themes × light/dark** with a sophisticated dual-token architecture
  (`--acr-*` raw + shadcn HSL), plus semantic ramps most systems never make
  (heat = activity intensity, density = choropleth — sentiment-separated).
- **A real motion *grammar*** (`lib/motion-tokens.ts`, 5/5): named durations,
  Linear/Stripe/Apple-HIG easings + springs, an enforced "all exits run fast"
  rule, three-layer reduced-motion handling.
- **A rigorously-specified type scale** (5 font pairings, self-hosted variable
  fonts, named levels with size/LH/weight/tracking).

### Design-language coherence verdict (per layer, 1–5)
| Layer | Score | State |
|---|---|---|
| Motion | 5 | Systematic SoT — **do not touch** (`motion-tokens.ts`/`animations.ts`) |
| Color / theming | 4 | Systematic tokens; gap = 30-file raw-hex debt (stale ledger), drifted docs |
| Typography | 4 | Strong scale, ~85% enforced; h1–h6 display coupling intentional; a few off-scale sizes |
| Component grammar | 4 | shadcn + house components canonical; minor warts (Button outline token, Badge hover) |
| Depth / materials | 3.5 | Glass kit rich BUT translucency per-component + **z-index entirely ad-hoc** |
| Signature interactions | 3.5 | Primitives exist (anticipate/bouncy/specular/shared-element); nothing composes them into "wow" beats |
| Spacing / layout | 3 | **Pure Tailwind default — undocumented; the biggest green field** |

### The real Tahoe gaps (what Phase 2 must build)
1. **Three green-field token scales** the spec never covered: **spacing/grid/measure**,
   **z-index/layering** (replaces `z-[60]`/`z-[100]`/`z-[9999]` ad-hoc), **translucency/opacity**
   (replaces 60+ untokenized `bg-*/95`).
2. **Enforcement** — nothing ratchets the spec, so it has drifted: the two docs
   disagree on hex values; theme count is internally inconsistent; the raw-hex
   ledger is stale (30 files, not the tracked ~15).
3. **Canonical, code-synced spec** — reconcile SYSTEM-V1 + DESIGN-SYSTEM into one
   `docs/design/design-language.md`, token tables generated from `index.css` not
   hand-maintained.
4. **Signature-moment choreography** — compose the existing primitives into the
   crown-jewel beats: witnessed-send ceremony, Today "you're done" payoff,
   parcel-slide-over reveal (the product's "Mission Control"), deal-closed
   celebration.

**Strategic read (endorsed): Phase 2 is consolidate-and-enforce, not
design-from-scratch.** The hard part (materials, motion, themes, type) is built;
codifying the 3 missing scales + reconciling + ratcheting + composing the
signature moments buys ~80% of the "designed" feeling at low risk.

## Phase 1 — Snow Leopard (refine to consistency) — COMPLETE + LOCKED
- Status: done over the prior session; the `lint:date-format` ratchet (this
  commit) closes the last unenforced gap.
- **Phase 1.5 follow-up (bounded):** drive the date-format baseline 30→0
  (migrate the grandfathered sites to `lib/format`), and the same for the hex (6)
  + hover (17) baselines when those files are next touched.

## Phase 2 — Tahoe (elevate the design language) — PLANNED, gated on 🔑
Proposed structure for the canonical `docs/design/design-language.md`:
1. Foundations — color (auto-gen token table), typography (port SYSTEM-V1 §1.2),
   **spacing/grid (new)**, **elevation + z-index + translucency (new, unified)**,
   motion (port `motion-tokens.ts`).
2. Materials — formalize the glass/depth kit as the house "Tahoe" material language.
3. Components — promote SYSTEM-V1 §4 inventory; resolve the open warts.
4. Patterns — page shells, editorial header, ResponsiveModal, provenance,
   loading/empty/error.
5. Motion grammar + signature interactions.
6. Voice — port DESIGN-SYSTEM §Voice.
7. Enforcement — CI ratchet on hex/z-index/inline-motion/off-scale-type (+ the
   Storybook-vs-ratchet decision below).

**Highest-leverage signature interactions to reimagine (not restyle):**
witnessed-send ceremony · Today decision-queue "done" beat (unused `bouncy`
spring) · parcel slide-over reveal · deal-closed celebration.

## Do-not-touch (preserve through any redesign)
- **Motion system**: `lib/motion-tokens.ts` + `lib/animations.ts`.
- **Perceived-speed defaults**: `queryClient.ts` (gcTime/staleTime/no-refocus/401-retry).
- **The ratchet idiom**: `scripts/ratchet.mjs` + `scripts/ratchets/*.json` +
  `lint-page-hex`/`css-hover`/`prefetch-authority`/`date-format` — don't loosen baselines.
- **House primitives**: `empty-state.tsx` (single system), `query-error-state.tsx`,
  `chart-colors.ts`, `format.ts`, `finance.tsx:441` flagship skeletons, the
  pointer-density model + `hoverOnlyWhenSupported`.
- **A-grade surfaces** (do not re-grade): pax, inbox, today, finance, documents,
  portfolio, transparency, onboarding-v2, founder/{command,cost,customers,today,
  life-cockpit,recourse,appeals}, parcel-detail, note-detail, settings/pax-controls,
  tools/parcel-check, webhooks.
- **Crown-jewel kernels**: `approvalKernel.ts` (witnessed-send),
  `marketNetworkContributor.ts`+`sophiePrivacyGuard.ts` (k-anon), `financial_ledger`,
  single-source pricing (`pricing-copy.ts`←`tier-pricing.ts`/`tier-limits.ts`),
  grounding stack + honest-null confidence, `server/static.ts`, middleware ordering,
  the dated-incident-comment institutional-memory practice.

## 🔑 Founder decisions (gate Phase 2)
1. **Visual-departure boldness** — ✅ DECIDED 2026-06-11: **BOLD RE-SKIN on the kit.**
   Tom wants a deliberate new visual identity pass, not just consolidation — a
   bigger visible leap. Sequencing: still build the consolidate-and-enforce
   FOUNDATION first (the 3 token scales + canonical spec + ratchets are
   prerequisites for a coherent re-skin), THEN the bold re-skin, THEN signature
   moments. Phase 2 = foundation → bold re-skin → signature moments.
2. **Glass/depth commitment** — ✅ DECIDED 2026-06-11: **make liquid-glass/depth
   the systematic house language.** Tokenize translucency + z-index so depth is
   coherent everywhere; AcreOS commits to being a Tahoe-depth product.
3. **Theme count at launch** — 6 themes × 2 modes = 12 QA surfaces/component.
   Restrict to 2–3 customer-facing at launch?
4. **Default font pairing** — code defaults to `native`; brand-preferred is
   `editorial` (Fraunces). Ship which? (Kai recommended editorial.)
5. **Storybook vs CI-ratchet** — a living browsable reference (ongoing cost) vs a
   token-lint CI ratchet (enforcement, no catalog). Given the team's ratchet
   pattern, the latter likely fits better.
6. **Doc reconciliation** — bless SYSTEM-V1 as canonical + auto-generate/retire
   the stale DESIGN-SYSTEM.md, or merge both into the new spec.

None block Phase 1.5 (the date-format 30→0 migration) — that proceeds on the
established idiom regardless.
