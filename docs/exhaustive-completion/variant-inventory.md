# Gap 1.1.D — Variant Inventory

The V2 spec's "variant chooser" assumes the prototype offers parallel alternatives (A/B/C versions of the same surface, copy tier alternatives, naming convention options). The actual prototype is largely deterministic:

- `acreos/tier-a.jsx`, `tier-b.jsx`, `tier-c.jsx` are **sequential refinement layers** (foundations → upgraded pages → copy/states), not parallel voice samples. Tier-c is canonical.
- `command-center.jsx` defines a single `CommandCenter` component, not A/B/C versions.
- No `ops` vs `os` vs `letter` naming-convention switch in source — `AcreOS` is the consistent product name.
- `tweaks-panel.jsx` exposes runtime debug controls (density, color, font size) — those are *prototype-internal* tweaks, not founder-facing variant decisions.

Adapting D.1 to the actual decision space, the picker drives **three categories of decisions**:

## Category 1 — Per-surface visual review (27 decisions)

For each NEEDS-HUMAN-REVIEW auth surface from 1.1.B, the founder needs to:
- Open prototype + production side-by-side
- Verify visual fidelity (layout, density, typography, colors, spacing rhythm)
- Mark each as **accept** (matches prototype well enough), **fix-needed** (note specific gaps), or **rebuild** (production diverged too far)

| Slug | Surface | Tier | Prototype reference |
|---|---|---|---|
| home | /today | 1 | `acreos/command-center.jsx` (CommandCenter) |
| pipeline | /pipeline | 1 | `acreos/pages-tier1.jsx` (Pipeline) |
| parcels | /parcels/:id | 1 | `acreos/pages-tier1.jsx` (Parcels detail) |
| inbox | /inbox | 1 | `acreos/pages-tier1.jsx` (Inbox) |
| contacts | /contacts | 1 | `acreos/pages-tier1.jsx` (Contacts) |
| calendar | /calendar | 1 | `acreos/pages-tier1.jsx` (Calendar) |
| buybox | /buyboxes | 2 | `acreos/pages-tier2345.jsx` (Buybox) |
| lists | /lists | 2 | `acreos/pages-tier2345.jsx` (Lists) |
| campaigns | /campaigns | 2 | `acreos/pages-tier2345.jsx` (Campaigns) |
| perf | /campaigns/performance | 2 | `acreos/pages-tier2345.jsx` (Performance) |
| offers | /offers | 3 | `acreos/pages-tier2345.jsx` (Offers) |
| documents | /documents | 3 | `acreos/pages-tier2345.jsx` (Documents) |
| finance | /finance | 3 | `acreos/pages-tier2345.jsx` (Finance) |
| dispos | /dispositions | 3 | `acreos/pages-tier2345.jsx` (Dispositions) |
| agents | /agents | 4 | `acreos/pages-tier2345.jsx` (Agents) |
| automation | /automations | 4 | `acreos/pages-tier2345.jsx` (Automations) |
| audit | /audit | 4 | `acreos/pages-tier2345.jsx` (Audit) |
| settings | /settings | 4 | `acreos/settings.jsx` |
| team | /team | 4 | `acreos/pages-tier2345.jsx` (Team) |
| billing | /billing | 4 | `acreos/pages-tier2345.jsx` (Billing) |
| integrations | /integrations | 4 | `acreos/round3-integrations.jsx` |
| pax | /ai | 4 | `acreos/pax.jsx` |
| founder | /founder | 5 | (founder home — no direct prototype) |
| atlas-run | /founder/atlas-run | 5 | (founder mode — no direct prototype) |
| founder-rev | /founder/revenue | 5 | (founder mode — no direct prototype) |
| founder-tenants | /founder/tenants | 5 | (founder mode — no direct prototype) |
| founder-cost | /founder/cost | 5 | (founder mode — no direct prototype) |
| founder-ops | /founder/ops | 5 | (founder mode — no direct prototype) |

Per-decision options:
- `accept` — fidelity is good enough; no fix needed
- `fix-needed` — note specific gaps (free-form notes); items roll into 1.1.C-followup queue
- `rebuild` — surface diverged too far from prototype; full re-implementation needed

## Category 2 — Global platform tweaks (3-4 decisions)

The prototype's `tweaks-panel.jsx` exposes runtime debug controls. Some of these are legitimate founder taste calls that belong in the production design system, not just prototype debug:

| decision_id | Type | Options | Recommended default | Notes |
|---|---|---|---|---|
| platform-density | density | compact / regular / comfy | regular | Affects all surfaces; sets `--acr-density-*` CSS vars |
| platform-primary-color | color | brand palette + custom hex | `var(--acr-brand)` (current) | Constrained to design system tokens |
| platform-font-size-base | size | 14 / 15 / 16 / custom | 16px | Affects readability across all surfaces |
| platform-dark-default | toggle | on / off | off | Whether dark mode is opt-in or default |

## Category 3 — Build-vs-defer decisions (4 surfaces)

From 1.1.C NEEDS-IMPLEMENTATION findings — prototype shows them but production doesn't have routes:

| decision_id | Surface | Options | Reason for decision |
|---|---|---|---|
| founder-revenue-route | /founder/revenue | build now / defer to post-launch / drop entirely | Prototype shows this as a founder-mode subroute; route not registered in App.tsx |
| founder-cost-route | /founder/cost | same | |
| founder-ops-route | /founder/ops | same | |
| founder-tenants-route | /founder/tenants | same | |

If `build now`: the picker captures the directive and 1.1.F applies it (route registration + page implementation).
If `defer`: the gap analysis treats them as "upcoming, not in scope for current pass."
If `drop entirely`: prototype reference is removed and inventory closes the decision.

## Picker UX implications

Given the actual decision space, the picker's primary value is **systematic visual review** rather than choose-A-or-B variant selection. The V2 spec's three-panel comparison (prototype | current | proposed-after) is exactly right for Category 1 — it lets the founder visually verify each surface in one pass.

D.6 sequence (per V2 spec, but reframed):
1. **Shell + nav** — sidebar lists all decisions grouped by category, main panel shows current decision
2. **Visual review chooser** (Category 1) — three-panel comparison + accept/fix-needed/rebuild + free-form notes
3. **Three-panel viewer** — same-origin iframe of acreos.io/<surface> + Babel-rendered prototype + (preview shows current state since accept/fix doesn't change UI in real time)
4. **Inline note editor** — multi-line textarea for fix-needed notes per surface
5. **Multi-breakpoint preview** — 320 / 375 / 414 / 768 / 1024 / 1440 + split view
6. **Density adjustment** (Category 2) — slider sets `--acr-density-*` overrides, applied as scoped CSS vars
7. **Color/token override** (Category 2) — token picker constrained to design-system palette
8. **Build/defer chooser** (Category 3) — radio + reasoning notes
9. **Export selections** to `founder-selections.json`
10. **UI polish pass**

## Selection format (D.6 step 9)

`docs/exhaustive-completion/founder-selections.json`:

```json
{
  "version": 2,
  "completed_at": "<iso-timestamp>",
  "category_1_visual_review": {
    "home": {
      "verdict": "accept | fix-needed | rebuild",
      "notes": "free-form per-surface notes",
      "decided_at": "<iso>"
    }
  },
  "category_2_platform_tweaks": {
    "platform-density": "compact | regular | comfy",
    "platform-primary-color": "var(--acr-brand) | <hex>",
    "platform-font-size-base": 14 | 15 | 16,
    "platform-dark-default": false
  },
  "category_3_build_vs_defer": {
    "founder-revenue-route": "build-now | defer | drop",
    "founder-cost-route": "...",
    "founder-ops-route": "...",
    "founder-tenants-route": "..."
  }
}
```

## Picker hosting decision (architectural)

Per 1.1.A note: SameSite=Lax cookies are not sent on cross-site iframe loads, so the picker iframes need the same origin as the production app. Two options:

**Option A — Picker served by acreos backend (recommended)**
- Build picker with Vite to a static bundle (`dist-picker/`)
- Add dev-only express route at `/__dev/picker/` that serves the bundle
- Picker iframes load `/<surface>` (relative URL → same origin → cookies work)
- Removed at 1.1.G alongside the bypass module

**Option B — Vite dev server with proxy**
- Picker runs at localhost:5173
- Proxies `/api/*`, `/<route>` to acreos.io
- Cross-origin issues for cookies; would need extra config

Option A is the path forward.
