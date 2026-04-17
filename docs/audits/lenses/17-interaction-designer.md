# Lens 17 -- Interaction Designer

Auditor: Interaction Design Specialist
Date: 2026-04-15
Scope: Micro-interactions, transitions, feedback patterns, affordances, tactile feel

---

## Executive Summary

AcreOS has invested significantly in a cohesive interaction language: the Tahoe-inspired "Liquid Glass" design system, a well-structured `animations.ts` library with consistent spring physics, a Dynamic Island status pill, framer-motion page transitions, and a polished drag-and-drop kanban. These foundations are strong, but adoption across 156 pages is inconsistent. Many pages lack loading/error feedback entirely, the kanban drag overlay disables its drop animation, optimistic updates are nearly absent, and the custom DealDetailDrawer bypasses Radix primitives -- losing keyboard trapping, transition animation, and accessibility. The gap between the best interactions (SwipeDecisionCard, Focus List) and the average page is large.

---

## Findings

### ID-01 DealDetailDrawer is a raw div, not a Sheet/Dialog

| Field | Value |
|-------|-------|
| Severity | P1 |
| Location | `client/src/pages/deals.tsx:1147-1176` |

The deal detail "drawer" is implemented as a manually positioned `<div className="fixed inset-0 z-50 bg-black/50">` with an inner `<div className="fixed right-0">`. It has:

- No entry/exit animation (appears instantly; page-wide overlay simply materializes).
- No keyboard focus trap: Tab can escape behind the overlay into the sidebar/main content.
- No `role="dialog"` or `aria-modal`.
- Close relies on click-outside only; Escape key is not handled.
- No spring or fade transition on open/close, which contrasts sharply with the glass-panel dialogs elsewhere.

This should use the existing `Sheet` component from `@/components/ui/sheet` (which wraps Radix Dialog with side-panel semantics) to get all of these behaviors for free.

---

### ID-02 Kanban drag overlay drops without animation

| Field | Value |
|-------|-------|
| Severity | P2 |
| Location | `client/src/pages/deals.tsx:787` |

```tsx
<DragOverlay dropAnimation={null}>
```

The `dropAnimation` is explicitly set to `null`, meaning when a deal card is released over a column, it snaps instantly to its new position instead of animating back. The drag pickup works (the ghost card renders via `DealCard`), but the release is visually jarring. The `@dnd-kit/core` default drop animation is a smooth translate-and-scale that should be preserved or replaced with a custom spring to match the app's physics language.

---

### ID-03 No optimistic update on kanban stage change

| Field | Value |
|-------|-------|
| Severity | P1 |
| Location | `client/src/pages/deals.tsx:135-144`, `client/src/hooks/use-deals.ts:93-117` |

When a deal card is dragged to a new column, `handleDragEnd` calls `updateDealStage({ id, status })`, which fires `apiRequest("PUT", ...)`. The comment says "Optimistic update via cache, then persist" but no `onMutate` handler exists in `useUpdateDeal`. The hook only has `onSuccess` (invalidate queries) and `onError` (toast). This means:

1. The card visually snaps back to its original column while the request is in flight.
2. After 200-500ms the data refetches and the card jumps to the new column.

The focus-list component (`client/src/components/focus-list.tsx:210-248`) demonstrates the correct pattern with `onMutate`/rollback. The kanban should replicate it.

---

### ID-04 Majority of pages lack structured error states

| Field | Value |
|-------|-------|
| Severity | P1 |
| Location | App-wide; only 9 of 156 pages use `QueryErrorState` |

Only these pages use the `QueryErrorState` component: `deals`, `leads`, `properties`, `pax`, `founder-home`, `executive-dashboard`, `finance`, `dashboard`, `onboarding-v2`. The remaining ~147 pages have no structured error recovery UI. When an API call fails on these pages the user either sees:
- A blank area where data should be (query returns `undefined`, components render nothing).
- An unhandled React error caught only by the top-level `ErrorBoundary` with a full-page crash screen.
- A destructive toast that auto-dismisses in 5 seconds with no retry action.

Pages like `market-intelligence`, `automation`, `inbox`, `marketplace`, `settings`, `tasks`, and `campaigns` all fetch data but lack any error recovery path in the render tree.

---

### ID-05 ~40% of pages lack loading skeletons

| Field | Value |
|-------|-------|
| Severity | P1 |
| Location | ~116 of 156 pages have no `Skeleton`, `ListSkeleton`, or `SkeletonTable` usage |

Only ~40 pages import and use skeleton components. The `PageShell` component supports an `isLoading` prop that renders a built-in skeleton, but many pages do not pass it. Examples:

- `market-intelligence.tsx` -- shows `analysisLoading` state but renders nothing while loading.
- `automation.tsx` -- queries `rules` and `executions` but has no skeleton; the page appears empty during fetch.
- `campaigns.tsx` -- delegates to sub-components but the shell itself has no loading pass-through.

---

### ID-06 Page transitions double-animate on initial load

| Field | Value |
|-------|-------|
| Severity | P2 |
| Location | `client/src/App.tsx:677-694`, `client/src/index.css:647-649` |

Two competing animation systems run on page mount:

1. **Framer Motion `PageWrapper`**: `AnimatePresence mode="wait"` with `pageTransition` variants (opacity 0->1, x: 8->0, 250ms).
2. **CSS `.page-enter`**: Applied via `PageShell` -> `<div className="... page-enter">`, which runs `@keyframes pageEnter` (opacity 0->1, y 4->0, scale 0.99->1, blur 2px->0, 300ms).

On every route change, both fire. The element fades in from the right (framer-motion) while also fading up and de-blurring (CSS). The visual result is a slightly confused double-transition where the element moves diagonally. These should be consolidated into a single system.

---

### ID-07 SwipeDecisionCard: no visual progress during mutation

| Field | Value |
|-------|-------|
| Severity | P2 |
| Location | `client/src/components/founder/SwipeDecisionCard.tsx:82-97` |

After the swipe gesture fires the approve/reject mutation, the card enters a 500ms flash-state then a 300ms dismiss timeout (total 800ms of artificial delay). During this time, if the actual API call takes longer, the card has already been dismissed (`setDismissed(true)`) and the user has no indication whether the action succeeded or failed. The `onSuccess` callback fires the flash, but `onError` has no handler -- a failed mutation will silently disappear the card. Add an `onError` handler that re-renders the card with an error indicator.

---

### ID-08 Toast notifications: no success variant, only default and destructive

| Field | Value |
|-------|-------|
| Severity | P2 |
| Location | `client/src/components/ui/toast.tsx:25-39` |

The toast system only has two variants: `default` (liquid-glass backdrop) and `destructive` (red). There is no explicit `success` variant with a green accent. All success toasts render as the default glass style, making them visually indistinguishable from informational messages. The user must read the title text to determine whether the toast is confirming a success or merely notifying.

---

### ID-09 Floating Action Button (FAB): no animation on expand/collapse

| Field | Value |
|-------|-------|
| Severity | P2 |
| Location | `client/src/components/floating-action-button.tsx:105-124` |

The FAB menu items use CSS `animate-in slide-in-from-bottom-2 fade-in` with staggered `animationDelay`, which is reasonable on open. However, on close the items simply unmount instantly (`{isOpen && (...)}` conditional rendering) with no exit animation. The FAB button itself rotates 45 degrees on open but has no spring physics -- it uses a linear `transition-transform duration-200`. The animation library defines `quickSpring` and `buttonTap` for exactly this purpose. The FAB should use `AnimatePresence` with `exit` variants for a polished dismiss.

---

### ID-10 useUnsavedChanges only guards browser navigation, not SPA routes

| Field | Value |
|-------|-------|
| Severity | P1 |
| Location | `client/src/hooks/use-unsaved-changes.ts` |

The hook only attaches to `window.beforeunload`, which fires on browser close/hard refresh. It does not intercept wouter route changes. If a user is filling out a form on `/deals` and clicks a sidebar link to `/leads`, the form data is silently lost. The hook needs to also intercept the wouter router (e.g., via `useBeforeRoute` or a custom blocker) to prompt for unsaved changes on SPA navigation.

---

### ID-11 Cursor-glass effect runs querySelectorAll on every mousemove frame

| Field | Value |
|-------|-------|
| Severity | P2 |
| Location | `client/src/hooks/use-cursor-glass.ts:20-28` |

The `flush` callback inside `requestAnimationFrame` calls `document.querySelectorAll(GLASS_SELECTOR)` on every single mouse-move frame. On pages with dozens of glass elements (the dashboard, founder pages), this DOM query runs 60 times per second, potentially causing layout thrashing. The selector should be cached and updated only when DOM mutations occur (via MutationObserver) or when components mount/unmount.

---

### ID-12 Kanban columns: no visual affordance for drag targets on mobile

| Field | Value |
|-------|-------|
| Severity | P1 |
| Location | `client/src/pages/deals.tsx:586-762` |

On mobile, the kanban disables DnD entirely and shows a card-swipe (stage carousel) interface instead. However, there is no gesture affordance indicating the user can swipe between stages -- only small dots at the bottom and a `Select` dropdown. The stage header lacks any swipe-left/right hint (e.g., partial peek of adjacent columns, edge arrows, or a "swipe to change stage" instruction). Users may not discover the navigation.

Additionally, the mobile kanban view disables individual card dragging but provides no alternative bulk-move affordance -- users must use the "Bulk Update" toolbar which requires checkbox selection on each card.

---

### ID-13 Command palette: AI mode has no streaming or typing indicator

| Field | Value |
|-------|-------|
| Severity | P2 |
| Location | `client/src/components/command-palette.tsx:176-184` |

The AI mutation in the command palette fires `apiRequest("POST", "/api/realtime/ask")` and waits for the full response. During this time, there is no streaming, typing indicator, or progress feedback in the command palette UI. The user types a question, presses enter, and sees nothing change until the full response returns (which can take 3-10 seconds for AI calls). There should be at minimum a `Loader2 animate-spin` or a pulsing "thinking" indicator.

---

### ID-14 Onboarding wizard: step transitions lack animation

| Field | Value |
|-------|-------|
| Severity | P2 |
| Location | `client/src/components/onboarding-wizard.tsx:427+` |

The onboarding wizard imports `motion` and `AnimatePresence` from framer-motion but does not wrap the step content in `AnimatePresence`. When the user clicks "Next" or "Back", the step content swaps instantly with no crossfade or slide. The `fadeInUp` variant from `animations.ts` is imported but appears unused in the step transitions. Given that this is the user's first interaction with the product, the lack of transition polish is especially noticeable.

---

### ID-15 Export CSV button: no completion feedback

| Field | Value |
|-------|-------|
| Severity | P2 |
| Location | `client/src/pages/deals.tsx:154-174` |

The `handleExport` function shows a `Loader2 animate-spin` during the export but provides no completion toast on success. The spinner stops and the icon returns to the download icon, but there is no "Export complete" toast or visual confirmation. On error, it only logs to `console.error` -- no user-facing error message. The same pattern exists in `handleBulkExport` (lines 209-226) which creates a blob download with zero feedback.

---

### ID-16 Form submit buttons: inconsistent loading state patterns

| Field | Value |
|-------|-------|
| Severity | P2 |
| Location | App-wide |

The DealForm correctly shows `Loader2 animate-spin` + "Creating..." text during submission (`deals.tsx:1947-1955`). However, other mutation-driven forms are inconsistent:

- `automation.tsx` create/edit mutations use `createMutation.isPending` but the submit button does not show a spinner or disabled state in the dialog (the button text stays static).
- `offer-wizard.tsx` `sendMutation` has no loading indicator on the "Send Offer" button.
- Many settings tab forms use ad-hoc mutation patterns without standardized submit-button feedback.

---

### ID-17 `prefers-reduced-motion` only covers CSS animations, not Framer Motion

| Field | Value |
|-------|-------|
| Severity | P1 |
| Location | `client/src/index.css:942-961`, `client/src/lib/animations.ts` |

The `@media (prefers-reduced-motion: reduce)` block in CSS disables `.page-enter`, `.toast-enter`, and other CSS animations. However, the 53 files using Framer Motion's `motion.*` components are completely unaffected by this media query. Framer Motion requires either:
- A `<MotionConfig reducedMotion="user">` wrapper at the app root, or
- Manual checks via `useReducedMotion()` hook.

Neither is implemented. Users who have requested reduced motion will still see all spring animations, page transitions, stagger effects, drag physics, etc. This is a WCAG 2.3.3 violation.

---

### ID-18 Dialog close button positioned at top-left (traffic light) breaks muscle memory

| Field | Value |
|-------|-------|
| Severity | P3 |
| Location | `client/src/components/ui/dialog.tsx:61-66` |

The dialog close button is positioned at `left-4 top-4` with a macOS "traffic light" style (`traffic-light-close`). While this is thematically consistent with the Tahoe design language, it breaks the near-universal web convention of placing close buttons at top-right. Users trained by every other web application will reach for the top-right corner. The `AlertDialog` component (used by `ConfirmDialog`) follows the standard Radix pattern and does not have this issue, creating an inconsistency between dialogs and alert dialogs.

---

### ID-19 Swipe navigation between pages: no visual edge indicator

| Field | Value |
|-------|-------|
| Severity | P2 |
| Location | `client/src/hooks/use-swipe-gesture.tsx` |

The global swipe-to-navigate hook allows swiping between `/`, `/leads`, `/properties`, `/deals`, `/finance`, `/settings`. This is a powerful mobile interaction, but:

1. There is no rubber-band edge effect or partial-page-peek during the gesture to indicate a swipe is in progress.
2. Navigation fires only after `touchend`, so the user gets no visual feedback until the page transitions.
3. When the user is on the first (`/`) or last (`/settings`) route, there is no bounce or visual cue that they have reached the edge.

Compare with iOS screen-edge swipe which shows a partial page preview during the gesture.

---

### ID-20 DealCard: GripVertical drag handle hidden on mobile but card still has grab cursor

| Field | Value |
|-------|-------|
| Severity | P3 |
| Location | `client/src/pages/deals.tsx:916-927` |

The `DealCard` component applies `cursor-pointer hover-elevate active:scale-[0.98]` to the outer `<Card>`, and the `GripVertical` drag handle is `hidden md:block`. On desktop, the card is clickable (opens detail drawer) while the grip handle initiates drag. On mobile, the grip handle is hidden, but the card's CSS still includes `cursor-grab active:cursor-grabbing` via the `touch-manipulation` class. Since DnD is disabled on mobile (the kanban switches to carousel mode), this false affordance is confusing.

---

### ID-21 Dynamic Island: auto-dismiss timer not paused on hover

| Field | Value |
|-------|-------|
| Severity | P3 |
| Location | `client/src/components/dynamic-island.tsx` |

The Dynamic Island shows transient status messages (save confirmations, AI thinking, deal alerts). The context exposes a `show()` method with a duration. However, the island does not pause its auto-dismiss timer when the user hovers over it, which means the message can disappear while the user is reading it. Toast implementations (like the Radix toast used elsewhere) pause on hover. The Dynamic Island should follow the same pattern.

---

### ID-22 Confirm dialog: no "processing" state for asynchronous confirm actions

| Field | Value |
|-------|-------|
| Severity | P3 |
| Location | `client/src/components/confirm-dialog.tsx:36-38` |

The `handleConfirm` function simply calls `onConfirm()` -- it does not prevent the dialog from being closed by the user during the async operation. While the `isLoading` prop disables the Cancel and Confirm buttons, the dialog's `onOpenChange` callback is still active, meaning the user can close the dialog (via overlay click or Escape) while the destructive action is in progress. This could lead to the user believing the action was cancelled when it actually completed. The `onOpenChange` should be suppressed when `isLoading` is true.

---

## Summary Table

| ID | Finding | Severity | Category |
|----|---------|----------|----------|
| ID-01 | DealDetailDrawer is raw div, no focus trap/animation | P1 | Affordance/A11y |
| ID-02 | Kanban drag overlay drops without animation | P2 | Transition |
| ID-03 | No optimistic update on kanban stage change | P1 | Feedback |
| ID-04 | 147 of 156 pages lack structured error states | P1 | Feedback |
| ID-05 | ~116 pages lack loading skeletons | P1 | Feedback |
| ID-06 | Page transitions double-animate (FM + CSS) | P2 | Transition |
| ID-07 | SwipeDecisionCard: no error handling on mutation | P2 | Feedback |
| ID-08 | Toast: no success variant (only default/destructive) | P2 | Feedback |
| ID-09 | FAB: no exit animation on close | P2 | Transition |
| ID-10 | useUnsavedChanges ignores SPA route changes | P1 | Affordance |
| ID-11 | Cursor-glass querySelectorAll on every frame | P2 | Performance |
| ID-12 | Mobile kanban: no swipe affordance for stage navigation | P1 | Affordance |
| ID-13 | Command palette AI mode: no loading indicator | P2 | Feedback |
| ID-14 | Onboarding wizard step transitions lack animation | P2 | Transition |
| ID-15 | CSV export: no completion or error feedback | P2 | Feedback |
| ID-16 | Inconsistent form submit loading indicators | P2 | Feedback |
| ID-17 | prefers-reduced-motion not wired to Framer Motion | P1 | A11y |
| ID-18 | Dialog close button at top-left breaks convention | P3 | Affordance |
| ID-19 | Swipe navigation: no visual edge/progress indicator | P2 | Affordance |
| ID-20 | Mobile DealCard: false grab cursor when DnD disabled | P3 | Affordance |
| ID-21 | Dynamic Island: auto-dismiss not paused on hover | P3 | Feedback |
| ID-22 | Confirm dialog closable during async operation | P3 | Feedback |

---

## Strengths Worth Preserving

1. **animations.ts library**: Well-structured with consistent spring constants (`quickSpring`, `smoothSpring`), semantic variant names (`fadeInUp`, `slideUp`, `scaleIn`), and proper stagger patterns. This is a solid foundation.

2. **SwipeDecisionCard**: Best-in-class interaction design -- Framer Motion drag with color interpolation, haptic feedback at threshold crossing, flash-state confirmation, spring physics on the checkmark, and fallback buttons for non-swipe users. This should be the reference implementation for all gesture-driven components.

3. **Focus List optimistic updates**: The `onMutate`/rollback pattern in `focus-list.tsx` is textbook TanStack Query optimistic update. Should be the template for all mutation hooks.

4. **Button base component**: CSS `active:scale-[0.96]` with `transition-all duration-150 ease-out` provides instant tactile feedback on every button press app-wide. The `hover:-translate-y-px` lift is subtle and effective.

5. **PageShell + ErrorBoundary**: The per-page ErrorBoundary wrapper prevents cascading failures. The skeleton support is there -- it just needs wider adoption.

6. **QueryErrorState**: Type-specific error categorization (network, server, auth, notFound) with appropriate icons and retry support. Well-designed component that simply needs to be used in more places.

7. **prefers-reduced-motion CSS block**: The CSS layer correctly disables animations, skeleton shimmer, and specular highlights. The gap is only on the Framer Motion side.

8. **ConfirmDialog with loading state**: The destructive-action confirmation pattern with spinner + "Processing..." text during async operations is well-executed.

---

## Priority Recommendations

### Immediate (P1 fixes)

1. **Replace DealDetailDrawer** with `<Sheet>` from `@/components/ui/sheet` to get focus trap, Escape handling, slide animation, and ARIA for free.
2. **Add `<MotionConfig reducedMotion="user">`** at the app root (in `App.tsx` wrapping the `<AnimatePresence>`) to respect the OS-level reduced motion preference for all Framer Motion animations.
3. **Add optimistic update to `useUpdateDeal`** following the `focus-list.tsx` `onMutate` pattern.
4. **Audit the top 20 most-visited pages** (dashboard, leads, deals, properties, tasks, inbox, settings, campaigns, finance, marketplace) and ensure each uses `QueryErrorState` for errors and either `PageShell isLoading` or inline `Skeleton` components for loading.
5. **Wire `useUnsavedChanges` to wouter** via a route-change blocker in addition to `beforeunload`.

### Short-term (P2 polish)

6. Remove `dropAnimation={null}` from DragOverlay or replace with a custom spring animation.
7. Consolidate page transitions: remove CSS `.page-enter` class or remove Framer Motion `PageWrapper`; use only one.
8. Add a `success` toast variant with a green accent.
9. Wrap FAB menu in `AnimatePresence` with staggered exit animations.
10. Add `AnimatePresence` to onboarding wizard step transitions.
11. Cache glass element references in `useCursorGlass` instead of querying DOM every frame.
