# Resume — Production Port Phase F (Capture + Per-Tier Audit)

**Active directive:** Production port autonomous run through Phase H.
Founder reviews at H complete. Bypass cleanup waits for approval.

Standing constraints (don't re-ask):
- No paid design assets
- Apple-native auto mode
- HSL adjacency in theme blocks
- `rounded-card: 14px`
- Judgment calls in `JUDGMENT-CALLS.md` (terse)
- No autonomous bypass cleanup

## Phase A-E summary (after Phase E close)

- A: Design-system extraction → `prototype-design-system.md`
- B: Theme + font + appearance settings + server persistence
- C: Personalization infra (sidebar / quiet hours / list views / autonomy)
- D: Feature flag 5-state machine + `/founder/features`
- E: Surface-by-surface re-skin across Tiers 1-5 + landing/pricing
  - Tier 1: today, pipeline, inbox (parcels deferred — no analog)
  - Tier 2: listings, direct-mail-campaigns, market-watchlist, buyer-network
  - Tier 3: offers, documents, finance
  - Tier 4: audit-log, agent-detail, automation
  - Tier 5: founder-strategy, founder-experiments (dashboard deferred)
  - Marketing: pricing fix (landing already clean; onboarding deferred)

## Phase F objective

Per founder directive: "Per-tier PORT-AUDIT-TIER-X.md files generated,
no founder review pause." Phase F generates the per-tier audit artifacts
that complement PORT-AUDIT-PHASE-E.md.

PORT-AUDIT-TIER-1.md was written at the E.2 gate. Phase F generates
TIER-2.md through TIER-5.md following the same shape.

## Phase F sub-phases

### F.1 — Per-tier audit docs

Generate four audit docs mirroring the Tier 1 shape:
- `PORT-AUDIT-TIER-2.md` — sourcing surfaces (listings + direct-mail-
  campaigns + market-watchlist + buyer-network)
- `PORT-AUDIT-TIER-3.md` — closing (offers + documents + finance)
- `PORT-AUDIT-TIER-4.md` — ops (audit-log + agent-detail + automation;
  most ops surfaces unchanged because clean)
- `PORT-AUDIT-TIER-5.md` — founder mode (strategy + experiments;
  dashboard explicitly deferred to Phase G)

Audit shape: voice / visual baseline / density / motion / component
grammar / agent presence / state coverage table per surface.

### F.2 — Live capture (deferred)

The directive's "re-capture every surface at 1440 + 375 in each theme +
each font pairing" requires a deployed production build with migrations
0028 + 0029 applied. Phase E commits aren't deployed yet. F.2 capture
work ships after deploy.

Capture infrastructure exists from earlier exhaustive-completion work:
`tests/e2e/capture-auth-surfaces.ts` + dev founder bypass at acreos.io.
Runtime capture reproduces 28 surface × theme variants when the new
themes are live.

For Phase F, document the capture protocol but don't execute (production
not deployed). Phase H will re-capture after the founder reviews and
deploys.

### F.3 — Phase G resume

Write `_RESUME-PORT-PHASE-G.md`:
- Six explicit polish surfaces (today, onboarding, founder mode, settings,
  landing, pricing)
- Carry-forward from Tier 1 self-audit (gradient cleanup, exclamation
  removal, etc.)
- Carry-forward from JUDGMENT-CALLS deferrals (E.6.1 founder-dashboard,
  E.7.1 onboarding-v2)
- State coverage completion per surface
- Deferred-wire consumption (`useListView` per surface, autonomy server
  enforcement, notifications matrix redesign)

## Phase G preview

Six surfaces, dedicated polish-pass effort. Per design-system §14:
1. /today — most-seen surface, sets daily tone. Hero greeting copy quality
   matters.
2. Onboarding flow — first impression. Multi-screen wizard. Walk-into-
   workspace feel.
3. Founder mode — daily working surface for founder. Continuous design
   language with subtle accent + denser layout.
4. Settings — trust surface. Calm despite depth.
5. Landing — high-stakes conversion. Editorial typography, restraint.
6. Pricing — trust-building register. Stripe-quality UX.

Settings already polished (Phase B-C). Landing already prototype-aligned.
Phase G focused work: today carryforward + onboarding-v2 + founder-dashboard
+ pricing polish details.

## Phase H preview

End-to-end verification:
- Walk full platform in each theme × each font pairing
- All customization flows tested
- No functionality regressions
- Mobile responsive verified at 320, 375, 768
- FINAL-PORT-AUDIT.md
- Stop. Founder review.

After Phase H review approval → Gap 1.1.G bypass cleanup (separate
authorization required).

## Bar for Phase F complete

- [ ] PORT-AUDIT-TIER-2.md
- [ ] PORT-AUDIT-TIER-3.md
- [ ] PORT-AUDIT-TIER-4.md
- [ ] PORT-AUDIT-TIER-5.md
- [ ] Capture protocol documented (runtime capture deferred to post-deploy)
- [ ] _RESUME-PORT-PHASE-G.md written
- [ ] No `npm run check` regressions

---

*Phase F is documentation work — it consolidates Phase E's surface ports
into per-tier audits without changing code.*
