# AcreOS Bold Tahoe Re-Skin — Treatment Recipe (Wave R0)

> **The shared playbook.** Every surface-re-skin agent applies THIS recipe,
> identically, so the platform-wide re-skin stays coherent and does not fragment
> into per-agent taste. This is the contract — when the prose here disagrees with
> an agent's instinct, this file wins.
>
> **Status:** Wave R0 of the elevation arc
> (`docs/internal/roadmap/elevation-arc-snow-leopard-tahoe.md`). Composes the
> token system in `docs/design/design-language.md` — it does not invent new
> tokens. Reference implementation: `client/src/components/page-topbar.tsx`
> (the most-inherited chrome; see §10).
>
> **Founder decisions in force (design-language §0):** BOLD re-skin (a deliberate
> new visual identity, not a tightened version of today); glass/depth is the
> systematic house language; `editorial`/Fraunces is the default pairing; flagship
> themes are **Bedrock** (light default), **Nocturne** (dark), **Slate** (light +
> dark). The bold look must read correctly across all three with zero per-theme
> hardcoding.

---

## 0. The bold thesis (read this before you touch anything)

"Bold" is not louder color or bigger borders. Bold = **depth, breathing room, and
editorial confidence**, applied systematically:

1. **Layered glass chrome.** Chrome floats above content on real Tahoe glass
   (blur + saturation + specular + a Track-1 shadow), not a flat tinted bar.
2. **Generous editorial spacing.** More breathing room than today — the new
   rhythm is one step up the spacing scale from the old defaults (§2.3).
3. **Fraunces-led hierarchy.** Display serif on page H1s and section heads; the
   eyebrow + greeting + soft-clause editorial pattern is the signature.
4. **Tokenized depth.** Surfaces stack via the `--z-*` scale and `--surface-*`
   scrims; cards earn elevation by nesting depth, not by taste.

Everything below is the mechanical translation of those four moves. **Behavior is
never changed — this is a visual re-skin only.** No logic, no data flow, no route
changes.

---

## 1. Chrome treatment (topbars, navs, rails, sticky headers)

Chrome is the #1 carrier of the Tahoe feel. The old pattern
(`backdrop-blur-md bg-surface-veil border-b border-border`) is flat. Replace it
with **layered glass**.

### 1.1 Primary sticky chrome (page topbar, sticky section headers)

Use this exact class composition:

```
sticky top-0 z-sticky bg-surface-chrome backdrop-blur-lg border-b border-border/60 shadow-level-1
```

- **Translucency:** `bg-surface-chrome` (the `.95` role) — NEVER `bg-background/95`
  or `bg-surface-veil` for primary chrome. Veil (`.80`) is too sheer for the
  top-level bar over scrolling content.
- **Blur:** `backdrop-blur-lg` (bumped from `-md`) — the bold depth read.
- **Border:** `border-b border-border/60` — a softened hairline, not a hard
  `border-border`. The `/60` alpha lets the glass edge feel like an edge of light,
  not a rule.
- **Shadow:** `shadow-level-1` (Track-1, mode-independent) — chrome casts a faint
  shadow onto the content beneath it. This is the single biggest "it floats now"
  signal. Track-1 (not `shadow-acr-*`) because chrome is theme-neutral glass.
- **Layer:** `z-sticky` (page topbar) — never `z-30`, never `z-[30]`.

### 1.2 Secondary / nested sticky chrome (sub-headers, table headers, filter bars)

```
sticky top-14 z-docked bg-surface-veil backdrop-blur-lg border-b border-border/50
```

- `bg-surface-veil` (`.80`) — lighter than the primary bar so the two layers read
  as distinct planes.
- `z-docked` (10), no shadow (it sits under the primary bar's shadow).

### 1.3 Sidebar / rails

The sidebar already uses `.vibrancy-sidebar` (28px blur). Do NOT re-skin the
sidebar material — it is canonical. If a rail lacks glass, give it
`.liquid-glass-subtle` (20px) plus `border-l border-border/50`.

### 1.4 Canvas-overlay chrome (controls floating over a map / full-bleed canvas)

```
bg-surface-haze backdrop-blur-lg border border-border/50 shadow-level-2 rounded-card
```

- `bg-surface-haze` (`.90`) is the canvas-overlay role. Floating controls earn
  `shadow-level-2` because they float over content on all sides, not just below.

---

## 2. Card / surface treatment

### 2.1 Elevation by nesting depth (the rule)

Elevation is assigned by **how deep the surface is nested**, not by taste:

| Nesting depth | Surface | Shadow | Background |
|---|---|---|---|
| **L0 — page content card** | top-level card on the page | `shadow-acr-1` | `bg-card` (solid) |
| **L1 — primary elevated card** | the hero/feature card, KPI strip | `shadow-acr-2` | `bg-card` (solid) |
| **L2 — floating panel** | popover, dropdown, inline panel | `shadow-acr-3` | `bg-popover` (solid) |
| **L3 — modal / over-backdrop** | dialog, sheet, command palette | `shadow-level-3` + `.liquid-glass` | glass |
| **L3 — full-page overlay** | large overlay panel | `shadow-level-3` + `.glass-panel` | glass |

- **Content cards use Track-2** (`shadow-acr-*`, theme-aware — the shadow hue is
  the theme's ink, so it coheres per-theme).
- **Glass/overlay surfaces use Track-1** (`shadow-level-*`, mode-independent).
- **Never mix:** a solid content card never gets `shadow-level-*`; a glass surface
  never gets `shadow-acr-*`.

### 2.2 When a card gets glass vs solid

- **Solid (`bg-card`)** is the default for in-flow content cards. Bold ≠
  everything-is-glass; glass over an opaque page background just looks muddy.
- **Glass** (`.liquid-glass` / `.glass-panel`) is reserved for surfaces that sit
  **over blurred/other content**: modals, sheets, overlays, slide-overs, the
  command palette, canvas-floating controls. That is the design-language rule
  (§2 Materials) — honor it. Re-skin agents drive glass adoption ONTO those
  over-content surfaces, not onto flat page cards.

### 2.3 Radius + the generous editorial spacing rhythm (bold = more breathing room)

- **Radius:** `rounded-card` (14px, locked) on every cardish surface. Do not
  approximate with `rounded-lg`. Capsule controls keep `rounded-full`.
- **The bold spacing step-up.** Today's interiors are `p-4` / `space-y-4`. The
  bold treatment moves ONE step up the 4pt scale for primary surfaces:

  | Context | Today | Bold treatment |
  |---|---|---|
  | Primary card interior | `p-4` | **`p-6`** (24px) |
  | Dense / nested card interior | `p-3` | `p-4` (16px) — keep dense where it's dense |
  | Page section stack | `space-y-6` | **`space-y-8`** (32px) — already the PageShell default; preserve it |
  | Section header → body gap | `mb-3` | **`mb-4`/`mb-6`** |
  | KPI / metric row gap | `gap-3` | **`gap-4`** (16px) |
  | Tight metadata row | `gap-1.5` | `gap-2` — unchanged, stays tight |

  Step UP primary surfaces; leave dense data rows dense. Every value stays on the
  4pt grid — never `p-[Npx]` ad-hocs.

---

## 3. Typography treatment (the Fraunces-led hierarchy)

The editorial default means **page H1s and section heads render in Fraunces**.
Lead with the editorial header pattern, then apply the type scale.

### 3.1 The signature editorial header (use on every page H1)

```html
<div className="acr-cc-hero">
  <div>
    <div className="acr-eyebrow">Section name</div>
    <h1 className="acr-cc-greeting">
      Bold headline <span className="acr-cc-greeting-soft">soft trailing clause</span>
    </h1>
  </div>
  <div className="acr-cc-hero-actions">{/* actions */}</div>
</div>
```

- **Eyebrow** (`.acr-eyebrow`) — 11px caps, +0.14em tracking, `--acr-ink-3`. The
  uppercase label above the headline.
- **Greeting** (`.acr-cc-greeting`) — 32px Fraunces, weight 600, −0.03em. The
  page H1. The trailing `.acr-cc-greeting-soft` span carries the muted secondary
  clause (the founder-voice soft trailing clause from design-language §6).
- **Never** replace `.acr-cc-greeting` with a raw `text-3xl font-bold` — you lose
  the Fraunces family + tracking + the editorial identity.

### 3.2 The type scale (apply these, in order)

| Role | Class | Family | Notes |
|---|---|---|---|
| Landing hero only | `.heading-display` | Fraunces 700 | landing `/` only; do not use in-app |
| Page H1 | `.acr-cc-greeting` / `text-hero` | Fraunces 600 | the editorial greeting |
| In-page section head | `.acr-section-h2` / `text-section-h2` | Fraunces 500 | "Decision Queue", "Activity" |
| Card title / panel header | `.heading-section` (or shadcn `CardTitle`) | Fraunces 600 | subsection grade |
| Body | `text-sm` | Inter 400 | prose, cells, list items |
| Emphasized body | `text-sm font-medium` | Inter 500 | |
| Eyebrow / status | `.acr-eyebrow` / `text-caption` | Inter 600 caps | uppercase labels |
| Metric value | `.acr-metric-value` | Fraunces 600 | dashboard KPIs |

- **Bold-but-legible weights:** display headings hold **600** (700 only on the
  landing hero). Do not push body to bold for "boldness" — the boldness lives in
  the serif display + spacing + depth, not in heavier body text.
- **Do not touch** the `font-italic` Fraunces hero on `/` (sacred constraint).

---

## 4. Depth & layering

Stack surfaces using the `--z-*` semantic scale and `--surface-*` scrims — never
ad-hoc `z-[N]` or `bg-black/40`.

- **Layer order (low→high):** content `z-base`/`z-raised` → sticky chrome
  `z-docked`/`z-sticky` → dropdowns `z-dropdown` → FAB/nav `z-floating` → modal
  scrim + dialog `z-modal` → toasts `z-toast`. Always use the token name.
- **Overlay scrims:** modal/dialog backdrops use `bg-surface-scrim` (`.40`);
  heavy/destructive backdrops use `bg-surface-scrim-strong` (`.80`). Never
  `bg-black/40`.
- **The layered-glass feel:** when two glass planes stack (e.g. primary topbar +
  secondary filter bar), give the upper plane the heavier translucency role
  (`chrome` over `veil`) and a `shadow-level-1`, the lower plane the lighter role
  and no shadow. The shadow between planes is what sells the depth.
- **Specular is automatic:** `.liquid-glass*` / `.glass-panel` already paint the
  `::before` specular highlight. Don't hand-roll gradients on glass surfaces.

---

## 5. Color & theme (token-driven so all 3 flagships just work)

The bold treatment is **entirely token-driven** — apply it once, it reads
correctly in Bedrock (terracotta/cream), Nocturne (warm-red/near-black), and
Slate (blue/teal). The rules that guarantee this:

- **Never write a raw hex, never write `bg-[#…]`.** Use `bg-card`, `text-foreground`,
  `text-muted-foreground`, `border-border`, and the `--acr-*` map
  (`bg-acr-brand`, `text-acr-ink-3`, …). The flagship themes define every token;
  hardcoding breaks one of the three.
- **Tinted washes:** use the `-soft` variants (`bg-acr-brand-soft`) — the raw-hex
  `--acr-*` tokens do NOT support the `/NN` alpha modifier. (HSL System-B tokens
  like `bg-primary/40` DO.)
- **Glass tint comes from the theme** automatically — `--surface-*` and the glass
  `--glass-bg-*` vars inherit each theme's `--background`, so `bg-surface-chrome`
  is cream-glass in Bedrock and near-black-glass in Nocturne with zero per-theme
  code.
- **Shadows cohere per-theme** because Track-2 (`shadow-acr-*`) uses each theme's
  ink as the shadow hue. That is why content cards use Track-2, not Track-1.
- **Accent guidance:** the brand accent (CTAs, active states, focus) is
  `--acr-brand` / `bg-primary`; secondary highlights are `--acr-accent`. Heat /
  demand-intensity ALWAYS uses `--acr-heat-*` (never the outcome `pos/warn/neg`
  ramp) — a "hot market" is good, a "hot error" is bad; keep them separate.
- **Per-theme accent is not your job** — there is no per-theme override to write.
  If the bold look needs a new shared value, that is a token gap → flag it (§9),
  don't hardcode it in one surface.

---

## 6. Motion application (compose the existing grammar — never modify it)

`motion-tokens.ts` + `animations.ts` are DO-NOT-TOUCH. Apply, don't invent:

- **Page entrance:** the PageShell content wrapper already carries `.page-enter`
  (the CSS pageEnter keyframe). For lists/grids of cards, wrap in
  `staggerContainer` and give each item `staggerItem` (imported from
  `@/lib/animations`) — never inline a `staggerChildren` number.
- **Card hover:** desktop-only lift via the `cardHover` Framer pattern OR the CSS
  `.hover-elevate` (touch-safe, no transform) — **never both on one element**
  (design-language §3 hover split). For a glass card, prefer `.hover-elevate`.
- **Spring physics:** taps → `SPRINGS.snappy`; modal/sheet entry → `SPRINGS.smooth`;
  accordions → `SPRINGS.gentle`; celebration beats → `SPRINGS.bouncy` (Wave S
  only — don't sprinkle it). Import from `motion-tokens`, never hand-roll
  stiffness/damping.
- **Exit-fast rule (hard):** ALL exits run at `DURATIONS.fast` (0.15s). Never exit
  at `slow`/`slower`.
- **Reduced motion:** any surface you ADD spatial movement to must wrap its
  transition in `useRespectfulTransition` / `useRespectfulVariants`. The re-skin
  rarely adds new motion (it's visual) — if you do, this is mandatory.

---

## 7. What NOT to touch (do-not-touch list)

- **`client/src/lib/motion-tokens.ts` + `animations.ts`** — the motion SoT. Apply
  only.
- **A-grade surface LOGIC** — re-skin the markup/classes, never the data flow,
  state, queries, or handlers. Behavior must be byte-for-byte identical.
- **Crown-jewel kernels** — approval/witnessed-send, grounding/provenance,
  e-sign, permission ladder. Don't restyle their behavior; visual chrome only.
- **The CI ratchets** (`scripts/lint-*.mjs`, `scripts/ratchet.mjs`) and their
  baselines — never loosen a baseline. The re-skin should DRIVE z-index /
  translucency baselines DOWN by construction (replacing ad-hocs with tokens),
  never up.
- **`.vibrancy-sidebar`** material, the macOS traffic-light `#FF5F57`, the landing
  `font-italic` Fraunces hero — all sacred.
- **`client/public/sitemap.xml`, `client/public/robots.txt`,
  `docs/internal/solene-team-state.md`** — out of bounds for this wave.

### Invariants to preserve (verify every one, every surface)

- **A11y:** contrast ratios hold across all 3 flagship themes × 2 modes; visible
  focus state on every interactive element (`--acr-ring` / focus-visible);
  `aria-label` on every icon-only button. Re-skin must not regress any of these.
- **Pointer density:** the 44px touch floor stays — keep
  `min-h-[44px] min-w-[44px]` / `pointer-coarse:` arms; the `pointer-fine:md:h-9`
  dense arm must compile AFTER the coarse arm (don't reorder).
- **House states:** `Skeleton` (shape-matched, not spinners), `QueryErrorState`
  (retry), `EmptyState` (purposeful CTA) — keep them, restyle within the system.
- **No raw scales:** no raw hex, no `z-[N]`/`z-50`, no `bg-*/NN` translucency
  ad-hoc, no off-grid `p-[Npx]`. Use the named scales — the ratchets enforce it.
- **Behavior unchanged:** visual re-skin ONLY.

---

## 8. Per-surface checklist (the fan-out agents follow this, in order)

For each surface you re-skin:

1. **Chrome** — sticky bars/headers → `bg-surface-chrome backdrop-blur-lg
   border-b border-border/60 shadow-level-1 z-sticky` (§1). Nested chrome →
   veil/`z-docked` (§1.2).
2. **Cards** — assign shadow by nesting depth (`shadow-acr-1/2/3` for solid
   content; `shadow-level-*` + glass for over-content). `rounded-card`. Glass only
   on over-content surfaces (§2).
3. **Spacing** — step primary interiors up to `p-6`, section stacks to
   `space-y-8`, KPI gaps to `gap-4`; keep dense rows dense. Stay on the 4pt grid
   (§2.3).
4. **Type** — editorial header (`acr-cc-hero` > `acr-eyebrow` + `acr-cc-greeting`
   + soft clause); section heads `.acr-section-h2`; display weight 600 (§3).
5. **Depth** — `--z-*` tokens for stacking, `bg-surface-scrim` for backdrops; let
   the specular `::before` do the highlight work (§4).
6. **Motion** — apply `staggerContainer`/`staggerItem`, the right `SPRINGS.*`,
   exit-fast; respect reduced-motion if you add movement (§6).
7. **Verify across 3 flagship themes × 2 modes** — Bedrock light, Nocturne dark,
   Slate light + dark. Check: contrast, focus rings, glass tint, shadow cohesion,
   the editorial header. No raw hex / `z-[]` / `bg-*/NN` (grep your diff). 44px
   touch floor intact. **Behavior identical.**
8. **CSS safety** — if you touched any `.css`, the orchestrator `npm run build`-
   verifies (NOT `npm run check`). Never write `*/` inside a CSS comment string —
   it breaks the build.

---

## 9. Known token gaps (flag, don't hardcode)

If the bold look needs a value the tokens don't yet provide, the fan-out agent
**flags it here / to the orchestrator — never hardcodes a one-off**. Gaps found
authoring R0:

- **No `border-glass` token.** Chrome borders currently borrow `border-border/60`
  as a softened hairline. The glass material's own edge color (`--glass-border`,
  white-ish at `.55`) is not exposed as a Tailwind `border-*` utility — only the
  `.liquid-glass*` classes consume it internally. A surface that wants the
  glass-edge border without the full material class has no token. For chrome,
  `border-border/60` is the sanctioned stand-in until a `border-glass` utility
  exists.
- **No `text-display` Tailwind token.** `.heading-display` is CSS-only (noted in
  design-language §1.2 open warts). In-markup hero hierarchy uses the class, not
  a utility. Not blocking; noted.
- **Chrome shadow direction.** `shadow-level-1` casts evenly; a top bar ideally
  casts DOWNWARD only. The current tracks are symmetric. Acceptable for R0 (the
  faint even shadow still reads as float); a `shadow-chrome` directional token is
  a future nicety, not a blocker.
