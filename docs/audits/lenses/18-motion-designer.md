# Lens 18 -- Motion Designer

Auditor: Motion Design Specialist
Date: 2026-04-15
Scope: Animation timing, easing, purpose, performance, and prefers-reduced-motion compliance

---

## Executive Summary

AcreOS has a well-structured central animation library (`client/src/lib/animations.ts`) that defines 14 reusable motion primitives -- springs, fades, staggers, modal transitions, and a page transition variant. The timing choices are tasteful and consistent within this file: durations stay in the 150-300ms range, easings use either natural springs or cubic-bezier curves, and stagger delays are tight (30-50ms). The library is imported across ~20 components, giving those surfaces a coherent feel.

However, the codebase has a severe reduced-motion compliance gap: none of the 682 framer-motion animation instances across 68 files respect `prefers-reduced-motion`. The CSS layer has a targeted `@media (prefers-reduced-motion: reduce)` block, but it only covers 12 specific CSS class names and cannot affect framer-motion's JavaScript-driven animations. There is no `<MotionConfig reducedMotion="user">` wrapper and no `useReducedMotion()` hook usage anywhere in the codebase. Users who have opted out of motion at the OS level still experience page transitions, stagger animations, scale-ins, spring physics, infinite pulse loops, and drag gestures.

Beyond the accessibility gap, there are inconsistencies in timing across ad-hoc inline animations, several infinite animations that run without purpose (ambient pings, bounces, mesh gradient shifts), and a confetti effect that spawns 50 framer-motion nodes simultaneously. The gap between the polished animation library and the actual per-component usage is wide.

---

## Findings

### MO-01 Framer Motion animations completely ignore `prefers-reduced-motion`

| Field | Value |
|-------|-------|
| Severity | P1 |
| Location | `client/src/App.tsx:677-694` (PageWrapper), `client/src/lib/animations.ts` (entire file), 68 files using `motion.*` |

The app wraps all page content in `<AnimatePresence mode="wait"><motion.div variants={pageTransition}>` at the router level (App.tsx:681-692). This means every single page navigation triggers a 250ms slide+fade transition that cannot be disabled by the user's OS-level `prefers-reduced-motion: reduce` setting.

The `@media (prefers-reduced-motion: reduce)` block in `index.css:943-961` only targets 12 CSS class names (`.sidebar-spring`, `.page-enter`, `.toast-enter`, etc.) and uses `animation: none !important; transition: none !important`. This has zero effect on framer-motion's `<motion.div>` elements, which animate via JavaScript and the Web Animations API.

There is no `<MotionConfig reducedMotion="user">` wrapper anywhere in the component tree, and a search for `useReducedMotion` returns zero results in client source files. This means all 682 framer-motion animation calls across 68 components play unconditionally:
- Page transitions (every navigation)
- Stagger list reveals (MorningBriefing, AnimatedList, dashboards)
- Modal/dialog scale-ins (OnboardingWizard, command palette)
- Skeleton pulse loops (SkeletonCard, SkeletonList, SkeletonTable)
- Drag gesture physics (SwipeDecisionCard)
- Dynamic Island spring entrance/exit

This is a WCAG 2.1 SC 2.3.3 (AAA) and SC 2.3.1 (A) concern. For users with vestibular disorders, the continuous page-level slide transitions and scale animations can cause discomfort.

**Remediation:** Add `<MotionConfig reducedMotion="user">` as a wrapper in `App.tsx` around the `<AnimatePresence>`. This single change propagates to all descendants and makes framer-motion skip animations when the OS preference is set.

---

### MO-02 Reduced-motion CSS block has incorrect `opacity: 0 !important` rule

| Field | Value |
|-------|-------|
| Severity | P1 |
| Location | `client/src/index.css:943-961` |

The reduced-motion media query sets `opacity: 0 !important` on all targeted elements alongside `animation: none !important`. This means when a user enables reduced motion, elements like `.page-enter`, `.toast-enter`, `.popover-spring`, and `.sub-items-reveal` become permanently invisible rather than simply appearing instantly.

```css
@media (prefers-reduced-motion: reduce) {
  .sidebar-spring,
  .content-spring,
  .page-enter,
  .toast-enter,
  .popover-spring,
  .sub-items-reveal,
  /* ... */
  {
    animation: none !important;
    transition: none !important;
    opacity: 0 !important;   /* <-- this hides the element entirely */
  }
}
```

The `.page-enter` class is applied to the main content area in `PageShell` (line 59: `page-enter` class on the content `<div>`). With reduced motion enabled, the main content area is set to `opacity: 0` and never becomes visible because the animation that would transition it to `opacity: 1` has been disabled. This makes the entire application appear blank for reduced-motion users.

**Remediation:** Change `opacity: 0 !important` to `opacity: 1 !important` (or remove the opacity rule) so elements are visible immediately without animation.

---

### MO-03 Infinite ambient animations run continuously without user benefit

| Field | Value |
|-------|-------|
| Severity | P2 |
| Location | Multiple files (see below) |

Several animations loop infinitely for purely decorative purposes, consuming compositor/GPU resources even when off-screen or in background tabs:

1. **`pulseAnimation`** (`animations.ts:174-181`): `repeat: Infinity` opacity oscillation (0.5 to 0.8 to 0.5, 1.5s cycle). Used by `SkeletonCard`, `SkeletonList`, `SkeletonTable` -- appropriate for loading skeletons but runs via framer-motion (no reduced-motion escape).

2. **`animate-pulse`** (Tailwind utility): Used in 90+ locations across the codebase. Many are appropriate (loading states, active recording indicators), but several are ambient decorations:
   - `floating-assistant.tsx:1653`: `animate-[pulse_3s_ease-in-out_infinite]` on the FAB background even when idle (no activity)
   - `floating-assistant.tsx:1662`: `animate-ping` on the FAB ring even when idle
   - `founder-dashboard.tsx:6834`: Mood dot pulses infinitely
   - `dynamic-island.tsx:19`: AI bot icon pulses even when not actively processing

3. **Mesh gradient shifts** (`index.css:855-868`): Three `@keyframes` animations (`meshShift1/2/3`) that continuously transform and scale gradient blobs. These are defined but not directly applied in the CSS file inspected -- if used via a class, they run infinitely.

4. **`animate-ping`** (Tailwind): Used in `floating-assistant.tsx`, `live-demo-mode.tsx`, `voice-analytics.tsx`, `onboarding-v2.tsx`, and `founder-dashboard.tsx`. The ping animation is a scale(2) + opacity(0) loop that is GPU-intensive and never stops.

5. **`animate-bounce`** (`floating-assistant.tsx:1671`): Sparkles icon bounces infinitely when there is activity. Bounce animations are the most vestibular-triggering Tailwind animation.

None of these infinite animations are covered by the CSS reduced-motion block. They are driven by Tailwind's built-in keyframes which are not included in the `.sidebar-spring, .page-enter, ...` selector list.

**Remediation:** Add Tailwind's animation utilities (`animate-pulse`, `animate-ping`, `animate-bounce`, `animate-spin`) to the reduced-motion CSS override, or add a blanket rule: `@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; } }`.

---

### MO-04 Confetti effect spawns 50 simultaneous framer-motion nodes

| Field | Value |
|-------|-------|
| Severity | P2 |
| Location | `client/src/components/onboarding/OnboardingProgress.tsx:49-88` |

The `Confetti` component creates 50 `<motion.div>` elements, each with independent `initial`, `animate`, and `transition` props including random durations (1-3s), random delays (0-0.5s), rotation to 360 degrees, and random x offsets. This fires on onboarding completion.

Each particle triggers an independent framer-motion animation instance. With 50 concurrent animations, this can cause:
- Frame drops on low-powered devices (especially mobile)
- A burst of layout/paint work during what should be a celebratory moment
- No reduced-motion handling (vestibular users see 50 rotating, falling particles)

The same `Confetti` component is duplicated -- it exists in both `OnboardingProgress.tsx:49` and appears to be usable from onboarding flows.

**Remediation:** Use a single `<canvas>` element for confetti (e.g., `canvas-confetti` library), limit particle count, and skip entirely when `prefers-reduced-motion` is set. Alternatively, replace with a static celebratory illustration.

---

### MO-05 Inconsistent spring physics across inline animations

| Field | Value |
|-------|-------|
| Severity | P2 |
| Location | Multiple components |

The `animations.ts` library defines two spring presets:
- `quickSpring`: stiffness 500, damping 30
- `smoothSpring`: stiffness 300, damping 25

However, many components define their own inline spring parameters that diverge from these presets:

| Component | Stiffness | Damping | Notes |
|-----------|-----------|---------|-------|
| `animations.ts` quickSpring | 500 | 30 | Central preset |
| `animations.ts` smoothSpring | 300 | 25 | Central preset |
| `SwipeDecisionCard.tsx:179` | 400 | 15 | Very bouncy (low damping) |
| `OnboardingWizard.tsx:376,459,548,608,668` | 200 | 15 | Slow and very bouncy |
| `onboarding-wizard.tsx:698` | 200 | 15 | Matches above |
| `quick-capture-fab.tsx:77` | 300 | 20 | Close to smoothSpring but not identical |
| `command-palette.tsx:375` | 500 | 32 | Close to quickSpring but not identical |
| `DynamicIsland.tsx:48-49` | 500 | 30, mass 0.8 | quickSpring + custom mass |
| `DynamicIsland.tsx:123` | 600 | 25 | Unique: high stiffness, moderate damping |
| `empty-states/*.tsx` | 200 | 15 | All four empty states use same bouncy spring |
| `query-error-state.tsx:144` | 200 | 15 | Matches empty states |

The damping value of 15 used in the OnboardingWizard and empty states produces visible overshoot/bounce. This feels noticeably different from the quickSpring (damping 30) used in the central library and gives the app an inconsistent tactile personality -- some surfaces feel snappy, others feel rubbery.

**Remediation:** Consolidate to the two defined presets in `animations.ts`. If a third "bouncy" variant is desired, define it explicitly (e.g., `bouncySpring: { stiffness: 200, damping: 15 }`) so it is intentional and discoverable.

---

### MO-06 Page transition fires on every route change including tab switches

| Field | Value |
|-------|-------|
| Severity | P2 |
| Location | `client/src/App.tsx:677-694` |

The `PageWrapper` component uses `key={location}` on the `<motion.div>`, which means every URL change -- including shallow tab switches within the same page -- triggers a full page exit-then-enter animation (250ms fade + 8px horizontal slide). For a user navigating between tabs on the Founder Dashboard or Settings page, this creates unnecessary motion that makes the interface feel slower than it is.

The `pageTransition` variant uses horizontal movement (`x: 8` enter, `x: -8` exit), which is appropriate for forward/backward navigation but misleading for lateral tab switches within a page. This overloads the directional semantics of the animation.

**Remediation:** Consider skipping the page transition for same-page tab changes (e.g., by extracting the path prefix and only animating when the top-level route changes). Alternatively, reduce the exit duration and remove the horizontal offset for a subtler cross-fade.

---

### MO-07 Empty states use 400ms duration -- slower than the library standard

| Field | Value |
|-------|-------|
| Severity | P2 |
| Location | `client/src/components/empty-states/LeadsEmptyState.tsx:15`, `DealsEmptyState.tsx:14`, `TasksEmptyState.tsx:14`, `PropertiesEmptyState.tsx:15`, `CampaignsEmptyState.tsx:14` |

All five empty state components use `transition={{ duration: 0.4 }}` for their container fade-in, which is notably slower than the library's standard durations:
- `fadeIn`: 200ms
- `fadeInUp`: 250ms
- `slideUp`: 300ms

The 400ms duration makes empty states feel sluggish, especially since they also chain a spring animation (delay 0.1s, stiffness 200, damping 15) for the icon and additional delayed fades (delay 0.2-0.4s) for decorative badges. The total perceived entrance time exceeds 800ms, which is above the threshold where users start noticing delay.

The `QueryErrorState` component uses the same 400ms + 200+15 spring pattern, making error states equally slow to appear.

**Remediation:** Align with library standard durations (200-300ms) and tighten delay chains so total entrance time stays under 500ms.

---

### MO-08 `animate-spin` used in 160 files with no reduced-motion coverage

| Field | Value |
|-------|-------|
| Severity | P2 |
| Location | 423 occurrences across 160 files |

The Tailwind `animate-spin` utility (infinite rotation) is used extensively, primarily on `<Loader2>` icons for loading states. While loading spinners are a standard pattern, 423 occurrences of perpetual rotation across 160 files is a significant volume of motion for users with vestibular sensitivities.

The CSS reduced-motion block in `index.css:943-961` does not target `animate-spin`. Tailwind's default `@media (prefers-reduced-motion: reduce)` rules (provided by the `tailwindcss-animate` plugin) may partially cover this, but the explicit override block in `index.css` does not.

**Remediation:** Verify that the `tailwindcss-animate` plugin's reduced-motion handling is active. If not, add `.animate-spin` to the reduced-motion selector list, or replace spinner rotation with a static "loading" state for reduced-motion users.

---

### MO-09 Sidebar collapse uses overshoot easing

| Field | Value |
|-------|-------|
| Severity | P3 |
| Location | `client/src/index.css:587-595` |

The sidebar and content area use `cubic-bezier(0.34, 1.56, 0.64, 1)` for their width/margin transitions. This curve has a control point at `y=1.56`, which means the value overshoots its target by ~56% before settling. For a sidebar collapse, this means the sidebar width briefly goes past its collapsed size before bouncing back, and the content margin-left momentarily jumps past its final position.

While subtle, this overshoot creates visible content jank during the 280ms transition -- text in the main area shifts past its final position and snaps back. On pages with data tables or maps, this can cause a brief flash of misaligned content.

**Remediation:** Use a non-overshooting ease like `cubic-bezier(0.25, 0.46, 0.45, 0.94)` (which the `slideUp` animation already uses) or the standard `ease-out`.

---

### MO-10 Duplicate page-enter animation: CSS and Framer Motion compete

| Field | Value |
|-------|-------|
| Severity | P3 |
| Location | `client/src/components/page-shell.tsx:59`, `client/src/App.tsx:681-692` |

Page content receives two independent entrance animations:

1. **CSS**: The `page-enter` class in `PageShell` (`page-shell.tsx:59`) applies a CSS `@keyframes pageEnter` animation: 300ms fade + translateY(6px) + scale(0.995) + blur(2px).
2. **Framer Motion**: The `PageWrapper` in `App.tsx:681-692` applies the `pageTransition` variant: 250ms fade + translateX(8px).

These two animations run concurrently on overlapping elements (the framer-motion `<div>` wraps the `PageShell` which contains the `page-enter` div). The result is a compound animation where the content fades in while simultaneously sliding both horizontally (framer) and vertically (CSS), and de-blurring (CSS). This double-animation wastes compositor resources and creates a more complex motion path than either animation alone intends.

**Remediation:** Remove one of the two animations. The framer-motion `pageTransition` is the more capable system (supports exit animations and AnimatePresence orchestration), so removing the CSS `page-enter` class from `PageShell` is the simpler fix.

---

### MO-11 `AnimatedList` imports `staggerContainer` but redefines it inline

| Field | Value |
|-------|-------|
| Severity | P3 |
| Location | `client/src/components/ui/animated-list.tsx:3, 20-29` |

The `AnimatedList` component imports `staggerContainer` and `staggerItem` from `animations.ts` but only uses `staggerItem` for its children. The container variant is redefined inline with identical values (`staggerChildren: 0.05`, though `delayChildren` is parameterized via the `delay` prop instead of the library's `0.02`). The import of `staggerContainer` is unused.

This is a minor inconsistency, but it means changes to `staggerContainer` in the library will not propagate to `AnimatedList`.

---

### MO-12 Floating assistant FAB stacks three infinite animations simultaneously

| Field | Value |
|-------|-------|
| Severity | P2 |
| Location | `client/src/components/floating-assistant.tsx:1649-1673` |

The floating assistant button stacks three concurrent infinite CSS animations on nested elements:
1. `animate-pulse` (or `animate-[pulse_3s_ease-in-out_infinite]`) on an inner gradient div
2. `animate-ping` (or `animate-[ping_4s_ease-in-out_infinite]`) on a ring div
3. `animate-bounce` on the Sparkles icon (when `hasActivity` is true)

All three run simultaneously and infinitely. The `animate-ping` animation scales an element to 200% and fades it to 0 in a loop, which forces the compositor to continuously repaint a growing/shrinking circle. Combined with `animate-pulse` (opacity oscillation) and `animate-bounce` (translateY oscillation), this creates a visually busy, attention-grabbing element that is always in motion.

For vestibular-sensitive users, this triple-animation FAB is likely to cause discomfort, especially because it is persistent (always visible when logged in) and positioned at the screen edge where peripheral vision is most sensitive to motion.

None of these animations are covered by the reduced-motion CSS block.

**Remediation:** Reduce to a single subtle animation (e.g., a gentle pulse on activity, static otherwise). Ensure all FAB animations are disabled under `prefers-reduced-motion: reduce`.

---

### MO-13 SwipeDecisionCard drag gesture has no keyboard alternative

| Field | Value |
|-------|-------|
| Severity | P2 |
| Location | `client/src/components/founder/SwipeDecisionCard.tsx:130-143` |

The SwipeDecisionCard uses framer-motion's `drag="x"` for its primary interaction (approve/reject). The drag animation uses `dragElastic={0.3}` and spring physics for the release snap-back. While there are explicit approve/reject buttons in the expanded state, the primary interaction model is a swipe gesture with:
- Color interpolation during drag (green for approve, red for reject)
- Haptic feedback at 60% threshold
- Velocity-adjusted threshold (lower threshold at high velocity)

This gesture-driven animation has no `prefers-reduced-motion` accommodation. Users who have opted out of motion still experience the elastic drag, color transforms, and spring snap-back. The `whileTap={{ scale: 0.99 }}` also runs unconditionally.

**Remediation:** When `prefers-reduced-motion` is active, disable the drag gesture entirely and surface the approve/reject buttons as the primary interaction.

---

## Timing Inventory

A summary of all distinct animation timings found in the codebase:

| Duration | Easing | Usage | Count |
|----------|--------|-------|-------|
| 100ms | ease-out | Button press, micro-interactions | ~5 |
| 120ms | linear | Dynamic island content exit | 1 |
| 150ms | ease-out | fadeIn exit, dropdown items, new-item-menu | ~4 |
| 200ms | ease-out | fadeIn, scaleIn, modalOverlay, sidebar, most CSS transitions | ~30 |
| 220ms | custom bezier | Dynamic island exit | 1 |
| 250ms | ease-out | fadeInUp, staggerItem, modalContent, pageTransition | ~25 |
| 280ms | overshoot bezier | Sidebar collapse (CSS) | 2 |
| 300ms | custom bezier | slideUp, getting-started checklist | ~5 |
| 400ms | default | Empty states, error states | ~6 |
| 1500ms | ease-in-out | Skeleton pulse (infinite) | 3 |
| 1600ms | ease-in-out | Shimmer skeleton (CSS, infinite) | ~10 |
| 2000ms | ease-in-out | Badge pulse (CSS, infinite) | ~3 |
| 3000ms | ease-in-out | FAB slow pulse (infinite) | 1 |

The core range (100-300ms) is well-chosen and aligns with Material Design and Apple HIG recommendations. The 400ms outliers in empty/error states and the infinite animations are the main timing concerns.

---

## Summary Table

| ID | Finding | Severity | Category |
|----|---------|----------|----------|
| MO-01 | Framer Motion ignores `prefers-reduced-motion` (68 files, 682 instances) | P1 | A11y |
| MO-02 | Reduced-motion CSS block sets `opacity: 0` -- hides content for reduced-motion users | P1 | A11y / Usability |
| MO-03 | Infinite ambient animations (pulse, ping, bounce) run without reduced-motion escape | P2 | A11y / Performance |
| MO-04 | Confetti spawns 50 concurrent framer-motion nodes | P2 | Performance |
| MO-05 | Inconsistent spring physics across inline animations (damping ranges from 15 to 32) | P2 | Consistency |
| MO-06 | Page transition fires on every route change including tab switches | P2 | UX / Performance |
| MO-07 | Empty/error states use 400ms -- slower than library standard | P2 | Consistency |
| MO-08 | `animate-spin` in 160 files has no reduced-motion coverage | P2 | A11y |
| MO-09 | Sidebar collapse uses overshoot easing causing content jank | P3 | Polish |
| MO-10 | Duplicate page-enter animation: CSS and Framer Motion compete | P3 | Performance / Consistency |
| MO-11 | AnimatedList imports staggerContainer but redefines it inline | P3 | Consistency |
| MO-12 | Floating assistant FAB stacks three infinite animations simultaneously | P2 | A11y / Performance |
| MO-13 | SwipeDecisionCard drag gesture has no reduced-motion accommodation | P2 | A11y |

---

## Strengths

1. **Central animation library**: `animations.ts` provides a cohesive set of 14 motion primitives with sensible defaults. Components that use it feel consistent.
2. **Spring physics for interactive elements**: The quickSpring and smoothSpring presets produce natural, non-robotic motion. The Dynamic Island spring entrance is particularly well-tuned.
3. **Stagger timing is tight**: 30-50ms stagger delays avoid the "domino effect" that slower staggers produce. Lists feel like they appear as a group with a subtle wave, not one-by-one.
4. **Exit animations are defined**: Most variants include an `exit` state, enabling proper AnimatePresence orchestration. Exit durations are consistently shorter than enter durations (150-200ms vs 200-300ms), which follows the principle that exits should be faster than entrances.
5. **CSS transitions use consistent tokens**: The `.card-glass-hover`, `.btn-press`, and `.hover-elevate` classes all use 100-200ms ease-out, creating a uniform micro-interaction feel.
6. **Drag interaction quality**: The SwipeDecisionCard's drag physics (elastic 0.3, velocity-adjusted threshold, haptic feedback at 60% threshold) demonstrate careful interaction design.
7. **CSS reduced-motion block exists**: While flawed (MO-02), the intent and structure are correct. It targets the right CSS classes -- the gap is only in coverage of Framer Motion and Tailwind animation utilities.
