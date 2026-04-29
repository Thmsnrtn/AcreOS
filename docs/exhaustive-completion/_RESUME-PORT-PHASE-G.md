# Resume — Production Port Phase G (Polish Pass on Six Extra-Attention Surfaces)

**Active directive:** Production port autonomous run through Phase H.
Founder reviews at H complete. Bypass cleanup waits for approval.

Standing constraints (don't re-ask):
- No paid design assets
- Apple-native auto mode
- HSL adjacency in theme blocks
- `rounded-card: 14px`
- Judgment calls in `JUDGMENT-CALLS.md` (terse)
- No autonomous bypass cleanup

## Phase A-F summary

- A: Design-system extraction
- B: Theme + font + appearance settings
- C: Personalization infra
- D: Feature flag 5-state machine + founder UI
- E: Surface-by-surface port across Tiers 1-5 + landing/pricing (~17 surfaces)
- F: Per-tier audit docs (TIER-1 through TIER-5) + Phase G resume

## Phase G objective

Per design-system §14: six surfaces deserve dedicated polish-pass effort.
Phase G executes that polish with full prototype reference comparison.

| Surface | Phase G work |
|---|---|
| `/today` | Tier 1 carryforward: Welcome Back gradient cleanup, Pulse score bar semantic tokens, hot-deals/Zap icon colors, onboarding banner exclamation removal, "All caught up" voice refine. State coverage completion. |
| Onboarding | onboarding-v2.tsx full re-skin (1543 lines, 56 hardcodes). Reference: `~/Desktop/acreos-design-export/acreos-onboarding/`. Multi-screen wizard — prototype tone. |
| Founder mode | founder-dashboard.tsx full re-skin (7435 lines, 293 hardcodes). AGENT_COLORS identity map reconciliation. /founder/atlas-run route audit. |
| Settings | Already polished in Phase B-C. Final pass: ensure all sections feel calm, group autonomy guardrails better, verify font-pairing previews render correctly per pairing. |
| Landing | Already prototype-aligned per landing.tsx docstring. Final pass: founder letter accessibility verification (per design-system: "verbatim somewhere accessible"). |
| Pricing | Already mostly clean. Final pass: trust-building register check (no fake urgency, comparison framing right per design-system §14). |

## Phase G sub-phases

### G.1 — /today carryforward
Tier 1 self-audit listed 7 polish items:
- Welcome Back gradient (`from-blue-50 to-indigo-50`) → semantic theme-aware
  treatment (subtle theme-tinted card, not hardcoded blue gradient)
- Pulse score bar conditional → semantic tones
- "Start here today" Zap icon (`text-amber-500`) → text-acr-warn or text-acr-brand
- Hot deals tile (`text-orange-500`) → text-acr-brand
- "Welcome to AcreOS!" → drop exclamation
- "All caught up!" → "Nothing pressing today." (refine voice)
- Card radius global migration: rounded-lg → rounded-card on Card primitive default
- State coverage: empty-filtered + recoverable error states

### G.2 — Onboarding re-skin
- Read `~/Desktop/acreos-design-export/acreos-onboarding/screens-1..4.jsx`
  + `clarity.css` for prototype tone
- Walk onboarding-v2.tsx screen-by-screen
- Replace 56 color hardcodes with semantic --acr-* tones
- Verify voice on each screen passes the founder-letter test
- Add motion respecting `prefers-reduced-motion`

### G.3 — Founder dashboard re-skin
- Read `~/Desktop/acreos-design-export/acreos/round3-integrations-2.jsx::FounderHomeC`
  for prototype reference
- Walk founder-dashboard.tsx (7435 lines) — focus on the highest-traffic
  blocks (greeting, metrics strip, agent activity feed). Defer
  long-tail blocks if >300 lines need touching.
- Reconcile AGENT_COLORS identity map: pick palette consistent with
  prototype's `acreos/pax.jsx` agent-letter-mark approach
- Audit `/founder/atlas-run` route — may need to be built per Gap 1.1.C
  unimplemented founder routes finding

### G.4 — Settings final pass
- Walk Settings → Appearance → Type pairing cards in each pairing,
  verify sample text renders in actual fonts (Phase B.6 live-eye check)
- Walk Settings → Autonomy progressive disclosure — verify "calm despite
  depth" per design-system §7.5
- Walk Settings → Notifications — apply notifications matrix redesign
  deferred from C.2.1 (now scoped here per Phase E.5 ops landing)

### G.5 — Landing final pass
- Verify founder letter accessibility: design-system requires "verbatim
  somewhere accessible (about page, /why, or in the landing flow)".
  Audit current landing for letter inclusion; add if missing.
- Voice pass on hero, FounderNote, FAQ — confirm no hype language survived

### G.6 — Pricing final pass
- Verify no fake-urgency residuals (countdown timers, "limited time", etc.)
- Verify comparison framing right ("vs hiring a VA," "vs assembling 5
  separate tools")
- Audit CTA copy

### G.7 — Deferred wires consumption
Per Phase E.10 deferral list:
- `useListView(listType)` consumption: each list-bearing surface in
  Tiers 1-4 reads its preference. Wire on the surfaces touched in
  Phase E (12 list types in `LIST_VIEW_DEFAULTS`).
- Notifications matrix redesign (deferred from C.2.1 → landed here)
- AGENT_COLORS reconciliation (deferred from E.6.1)

### G.8 — State coverage completion
Per design-system §11: each of the six surfaces gets all four states
(loading / empty-zero / empty-filtered / error). The four states are
present on most Tier 1 surfaces; G.8 fills the gaps on the six explicit
polish surfaces.

### G.9 — PORT-AUDIT-PHASE-G.md + Phase H resume
- Document polish work
- Phase H resume with end-to-end verification protocol

## Bar for Phase G complete

- [ ] /today carryforward items resolved
- [ ] Onboarding re-skinned to prototype tone
- [ ] Founder dashboard re-skinned (or scope-limited and documented)
- [ ] Settings final-pass clean
- [ ] Landing founder-letter accessibility verified
- [ ] Pricing trust-register clean
- [ ] Deferred wires consumed where surfaces touched
- [ ] No `npm run check` regressions
- [ ] PORT-AUDIT-PHASE-G.md
- [ ] _RESUME-PORT-PHASE-H.md

## Phase H preview

End-to-end verification:
- Walk full platform in each theme × each font pairing
- All customization flows tested
- No functionality regressions
- Mobile responsive verified at 320, 375, 768
- FINAL-PORT-AUDIT.md

After Phase H complete and FINAL-PORT-AUDIT.md ready: stop, founder reviews,
then bypass cleanup (Gap 1.1.G) on founder approval.

---

*Phase G is where the highest-stakes surfaces get the design care the
brief explicitly schedules. Slow down, walk each surface against the
prototype, and the brief tests must pass.*
