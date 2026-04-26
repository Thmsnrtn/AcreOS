## Phase 2A.1 — Sidebar visual treatment per prototype

First commit applying the Visual Application Mandate. Replaces visual treatments that conflicted with the prototype while preserving engineering refinement.

### Prototype reference
`/acreos/shell.jsx:195-203` — `.acr-nav-item-active` and `.acr-nav-item-active::before`

### What changed

#### `client/src/index.css`

**Active nav-item treatment (`.nav-item-active` lines 703-722).** Replaced the Tahoe-capsule (rounded-full primary-tint pill with glass specular) with the prototype's homestead treatment:
- Subtle `var(--acr-surface)` background instead of `hsl(var(--primary) / 0.13)`
- `box-shadow: var(--acr-shadow-1), inset 0 0 0 0.5px var(--acr-line)` — soft elevation + hairline border
- 2px × 14px brand-color pip via `::before` at the row's left edge
- Default rectangular geometry (no border-radius override; the row's parent provides its own radius)

The pip is at `left: 0` (item's left edge) rather than the prototype's `left: -10px` (sidebar gap). Production's `<nav>` uses `overflow-x-hidden`, which would clip a negative-positioned pip. Same visual signature: brand-color marker on the active row.

**Sidebar surface (`.vibrancy-sidebar` lines 540-548).** Changed the rgba behind the vibrancy blur+saturation to the homestead literal:
- Light: `rgba(245, 240, 233, 0.82)` → `rgba(241, 231, 208, 0.82)` (= `#F1E7D0` from `acreos/theme.jsx`)
- Dark: `rgba(22, 16, 10, 0.86)` → `rgba(19, 12, 5, 0.86)` (= `#130C05`)

Preserved: the `backdrop-filter: blur(28px) saturate(185%)` glass effect (engineering refinement).

#### `client/src/components/layout-sidebar.tsx`

**Active-icon color.** All 8 `active ? "text-primary" : "text-muted-foreground"` ternaries replaced with `active ? "text-acr-ink" : "text-muted-foreground"`. The prototype does not tint icons brand on active rows — the active row's color (`var(--acr-ink)`) inherits naturally; explicit `text-acr-ink` makes the intent self-documenting.

**Header comment.** Updated to reflect Phase 2A.1 changes and what was preserved as engineering refinement.

### What's NOT changed (deferred)

| Item | Reason |
|---|---|
| Nav-item type at exactly 13px / -0.005em letter-spacing | Production uses `text-sm` (14px) and default tracking. 1px and a hair of letter-spacing fall below "meaningful platform feel" threshold; defer to Phase 9 if a coherence sweep finds it noticeable. |
| Active-row `<Badge>` brand-tinting | Prototype's `.acr-nav-item-active .acr-nav-badge` makes the badge brand-tinted. Production uses `<Badge variant="secondary">` which is fixed; would require an active-aware variant. Deferred to Phase 9. |
| Sidebar container padding `14px 10px` | Production uses tier-specific `p-3` / `p-4 md:p-5` / `p-2`. The current padding is close in value and breaks responsively, which was elite-refinement intent. Not changing. |
| Workspace/`⌃` affordance below brand | Optional prototype detail; defer to Phase 9 if desired. |
| Nav-group title typography | Production's expanded sidebar doesn't render group titles per group; the collapsed-children popover does have one (`uppercase tracking-wide`) which approximates the prototype's `letter-spacing: 0.07em uppercase` adequately. |

### Verification

- `npm run check` — clean
- `npm run build` — succeeds
- Visual change is now landed: active nav rows show a brand-color pip on the left + subtle elevated surface bg, instead of the rounded-full primary-tinted pill. The prototype's color identity (homestead cream sidebar with terracotta brand pip) lands.
- Authenticated production smoke at acreos.io after Phase 2A.5 deploy will confirm visually.

### Phase 2A progress
- [x] 2A.1 — sidebar visual treatment per prototype
- [ ] 2A.2 — Tier 0 visual application (palette modal, toaster kinds, shortcuts modal)
- [ ] 2A.3 — public landing page
- [ ] 2A.4 — public onboarding
- [ ] 2A.5 — deploy + smoke
