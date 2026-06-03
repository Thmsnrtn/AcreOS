# Krieger — Mobile-Feel Contracts

**Owner**: Krieger (Mobile Craft)
**Activated**: 2026-06-02
**Enforced by**: `tests/e2e-mobile/mobile-feel-contracts.spec.ts`
running on every push + PR via `.github/workflows/e2e-mobile.yml`,
across the five Playwright device projects (iPhone-14, Pixel-5,
iPhone-SE, iPhone-14-Pro-Max, iPad-mini).

## The four contracts

These are the four classes of mobile-feel bug that have shipped under
agent-driven feature work and required Krieger to post-hoc fix —
catching them at PR time costs minutes; catching them in production
costs customer trust.

### 1. Touch target ≥ 44 × 44 px

**Rationale**: WCAG 2.5.5 (Target Size, AAA) + Apple HIG (44pt) + Material
Design 48dp. Below 44px, finger-tap accuracy drops sharply for
thumb-reachable buttons on phones, and accessibility users with
motor-impairment can't reliably hit the target. iPad and iPhone-Pro-Max
viewports tolerate slightly smaller targets in practice, but Krieger
holds the uniform 44px floor so the contract is one rule, not five.

**Detection**: every visible, interactive `<button>`, `<a>`,
`[role="button"]`, `[role="link"]` element's `getBoundingClientRect()`
must satisfy `width >= 44 && height >= 44` at the test viewport.
Disabled, hidden, or `pointer-events: none` elements are skipped.

**Common failure**: icon-only buttons styled with `p-1` (4px padding)
on a 24px icon — total bbox 32px, below the floor. Fix: bump to `p-3`
(12px padding) or wrap the icon in a tappable parent with
`min-w-[44px] min-h-[44px]`.

### 2. `hover:` ↔ `active:` companion class

**Rationale**: iOS Safari simulates `:hover` on first-tap; the state
sticks until the user taps elsewhere. A button styled with
`hover:bg-blue-600` and no `active:`/`focus:` companion will visibly
change colour and stay that way after a touch — looking like a stuck
toggle. The fix: every `hover:` class on a touch-reachable element
gets a matching `active:` (preferred) or `focus:` class so the press
state is unambiguous.

**Detection**: at runtime, the spec walks every `button`, `a`,
`[role="button"]`, `[role="link"]` in the DOM, reads its `className`
string, and if `hover:` appears without `active:` or `focus:`, flags
it as a violation.

**Common failure**: copying a Tailwind class chain from a desktop
component (`hover:bg-accent hover:text-accent-foreground`) without
adding `active:bg-accent/80`. Fix: pair every hover state with an
active state.

### 3. `100dvh` over `100vh`

**Rationale**: iOS Safari's address bar collapses on scroll, changing
the effective viewport height. `100vh` is calculated against the
*large* viewport (address-bar collapsed), so a full-height element
gets clipped at the bottom when the address bar is visible. `100dvh`
(dynamic viewport height) updates as the bar collapses/expands, so
full-height elements stay exactly viewport-sized.

**Detection**: the spec scans every element's inline `style` attribute
for the literal `100vh`, and every `class` attribute for the Tailwind
aliases `h-screen` (= `100vh`) and `min-h-screen` (= `100vh`). Each
hit is a violation. Tailwind 3.4+ ships `h-dvh` and `min-h-dvh` as
the dynamic equivalents.

**Common failure**: a modal or sheet styled `h-screen` clips its
bottom row when the iOS address bar is visible. Fix: replace
`h-screen` with `h-dvh`, `min-h-screen` with `min-h-dvh`.

### 4. First-paint TTI < 3000 ms

**Rationale**: 4G median bandwidth + cellular RTT puts a soft ceiling
around 3s for the first meaningful render. Past that, customers on a
phone feel the page is broken; the Pax / Land Investor audience often
operates on cellular at job sites (we don't get to require wifi).

**Detection**: the spec measures `Date.now() - navStart` from
`page.goto()` to the first tappable element becoming visible. Above
3000ms, an `annotation: warn-first-paint` is recorded. *Currently
informational*, not a hard fail, because CI runner variance can spike
to multi-second cold starts and we don't want flaky-test churn until
the baseline settles. Krieger reviews the annotation count weekly
and converts to hard-fail when the baseline allows.

## Coverage matrix

Each contract runs against the five Playwright projects defined in
`playwright.mobile.config.ts`:

| Project | Viewport | Why it's in the matrix |
|---------|----------|-----------------------|
| iphone-14 | 390 × 844 | The baseline iPhone; most-common Tom-audience device |
| iphone-se | 375 × 667 | Narrowest current-spec iPhone — catches wrap-and-collide |
| iphone-14-pro-max | 430 × 932 | Widest current iPhone — catches "assumed ≤414px" surfaces |
| pixel-5 | 393 × 851 | Android Chrome baseline |
| ipad-mini | 768 × 1024 | Phone-stack ↔ desktop-grid boundary; catches wrong responsive arm |

Each of the seven routes audited — `/today`, `/map`, `/deals`,
`/money`, `/ai`, `/inbox`, `/settings` — runs against each project.
Total = 35 contract executions per CI run.

## Adding a new contract

When Krieger finds a new class of mobile-feel bug that ships post-hoc,
the response is:

1. **Add a fixture** to `tests/e2e-mobile/mobile-feel-contracts.spec.ts`
   that reproduces the bug.
2. **Add a collector** function in the same file (`collectXyzViolations`)
   following the pattern of the existing three.
3. **Wire the assertion** into the per-route `test` block with the
   same vendor-rendered allowlist treatment.
4. **Update this document** — add the rationale section + common-failure
   example. The "common failure" example is the most-important field;
   future Krieger reads this to understand what shape of code triggers
   the contract.
5. **Run the gate locally** against `iphone-14` (fastest project) to
   confirm baseline pass, then push.

## Out-of-scope (today)

- **Screen-reader semantics** — the WCAG aria-* checks live in a separate
  axe-core run, not here. (Krieger advocates for adding that pass once
  the touch-target floor is consistent.)
- **Animation reduce-motion** — covered by a separate Krieger-owned
  manual checklist; not yet automatable.
- **Theme contrast ratios** — Kai's `SYSTEM-V1.md` palette defines the
  intent; an automated contrast pass is a follow-on.
- **PWA offline behaviour** — not yet shipped; will get a separate spec
  when the service worker lands.

## Changelog

| Date | Change | Trigger |
|------|--------|---------|
| 2026-06-02 | Initial 4-contract spec across 5 device projects | Foundation tranche 1 |
