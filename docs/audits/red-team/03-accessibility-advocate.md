# Red Team Audit 03 -- Accessibility Advocate

**Persona**: WCAG 2.1 AA Compliance Auditor
**Auditor**: Automated code-level review
**Date**: 2026-04-18
**Scope**: Client-side React application (`client/src/`)
**Standard**: WCAG 2.1 Level AA

---

## Executive Summary

AcreOS demonstrates a **strong accessibility foundation** built on Radix UI primitives, semantic HTML, and a well-structured design token system. The previously reported DEFECT-0037 through DEFECT-0040 have all been resolved and verified. The application uses `MotionConfig reducedMotion="user"`, a functional skip link, aria-labels on icon buttons, and an unrestricted viewport. Remaining concerns are narrow but actionable: a few hardcoded colors in visualization components, missing `fieldset`/`legend` groupings on multi-field forms, absence of `aria-busy` on loading states, and the icon-size button touch target (36x36px) falling below the 44x44px WCAG recommendation for mobile.

**Overall grade: B+ (Strong foundation, minor gaps remain)**

---

## Area 1: Keyboard Navigation

### Skip Link
**Verdict: PASS**

A skip-to-content link is present at the top of the component tree and targets `#main-content`.

```tsx
// client/src/App.tsx:820
<a href="#main-content" className="skip-to-content" aria-label="Skip to main content">
  Skip to content
</a>

// client/src/App.tsx:758
<motion.div ... id="main-content">
```

The skip link is visually hidden off-screen and slides in on focus via CSS:

```css
/* client/src/index.css:439 */
.skip-to-content {
  transform: translateY(-100%);
  transition: transform 0.2s ease;
}
.skip-to-content:focus {
  transform: translateY(0);
}
```

This correctly satisfies WCAG 2.4.1 (Bypass Blocks). **DEFECT-0038 confirmed fixed.**

### Tab Order
**Verdict: PASS**

Components use Radix UI primitives (Dialog, Popover, DropdownMenu, Select, Accordion, Tabs) which provide correct focus trapping, roving tabindex, and keyboard dismiss via Escape. No `tabIndex` values greater than 0 were found that would disrupt natural DOM order. The single `tabIndex={-1}` usage is in the sidebar component (line 292) which is appropriate for programmatic focus management.

### Focus Management in Modals
**Verdict: PASS**

Dialog and Sheet components use Radix primitives that automatically trap focus and return focus to the trigger on close. The command palette (`CommandPalette`) and conversation tray both handle Escape key dismissal.

---

## Area 2: Screen Reader Support

### ARIA Labels
**Verdict: PASS**

208 `aria-label` occurrences across 94 component files. Icon-only buttons consistently include `aria-label`:

```tsx
// client/src/components/floating-help-button.tsx:35
<Button size="icon" variant="ghost" ... aria-label="Open help panel">
  <HelpCircle className="w-5 h-5" />
</Button>

// client/src/components/pax-copilot-rail.tsx:1060
<Button variant="ghost" size="icon" ... aria-label="Knowledge base">

// client/src/components/layout-sidebar.tsx:154
<button ... aria-label="Pax AI insights">
```

A grep for `Button.*size="icon"` without `aria-label` returned zero matches, confirming **DEFECT-0037 is fixed**.

### ARIA Roles
**Verdict: PASS**

Proper semantic roles are used throughout:
- `role="alert"` on `Alert` component and `FormMessage`
- `role="navigation"` with `aria-label="pagination"` on `Pagination`
- `role="region"` with `aria-roledescription="carousel"` on `Carousel`
- `role="dialog"` with `aria-label` on `CookieConsentBanner`
- `role="list"` / `role="listitem"` on `VirtualList`
- `role="group"` with `aria-roledescription="slide"` on `CarouselItem`
- `role="img"` on `DataConfidenceBadge`

### Screen Reader Text
**Verdict: PASS**

The `sr-only` class is used in 13+ locations for visually hidden but screen-reader-accessible text:
- Sheet close buttons: `<span className="sr-only">Close</span>`
- Sidebar toggle: `<span className="sr-only">Toggle Sidebar</span>`
- Carousel nav: `<span className="sr-only">Previous slide</span>`
- Pagination ellipsis: `<span className="sr-only">More pages</span>`
- Mobile command drawer: `<DrawerTitle className="sr-only">Quick Actions</DrawerTitle>`

---

## Area 3: Color Contrast

### Theme Token System
**Verdict: PASS (system) / CONCERN (hardcoded values in leaf components)**

The core design system uses HSL CSS custom properties via Tailwind, ensuring consistent contrast ratios between foreground and background:

```css
/* Light mode */
--background: 38 35% 96%;    /* ~#f5f0eb */
--foreground: 20 25% 18%;    /* ~#3a2f24 */
--primary: 18 48% 52%;       /* ~#c2724f */
--primary-foreground: 40 30% 98%;

/* Dark mode */
--background: 20 30% 8%;     /* ~#1a0d08 */
--foreground: 35 25% 92%;    /* ~#ede5dc */
--primary: 18 55% 58%;       /* brighter for visibility */
```

The light-mode contrast ratio for `foreground` on `background` calculates to approximately 10.5:1, well above the 4.5:1 AA minimum. The dark-mode ratio is similarly strong at approximately 11:1.

**Remaining concern**: Leaf components contain hardcoded hex colors for data visualization:

```tsx
// client/src/components/stat-card.tsx:27-28
emerald: { spark: "#22c55e" },
blue: { spark: "#3b82f6" },

// client/src/components/property-map.tsx:670-674
prospect: "#fbbf24",
due_diligence: "#f97316",
owned: "#22c55e",

// client/src/components/onboarding/OnboardingProgress.tsx:50
const colors = ["#f472b6", "#60a5fa", "#34d399", "#fbbf24", "#a78bfa"];

// client/src/components/signature-capture.tsx:62
ctx.strokeStyle = "#1a1a1a";
```

These are primarily used in SVG map markers, sparkline charts, and canvas drawing where Tailwind tokens are not applicable. The yellow (#fbbf24) on white backgrounds could fail WCAG AA contrast for text. For non-text elements like map markers, WCAG 1.4.11 requires 3:1 contrast against adjacent colors; the markers include dark strokes to maintain differentiation.

**Risk**: Low -- these are visualization-specific, not text content. The signature canvas uses sufficient contrast (#1a1a1a on #ffffff = 17:1).

---

## Area 4: Motion Sensitivity

### Framer Motion ReducedMotion
**Verdict: PASS**

The entire application is wrapped in `<MotionConfig reducedMotion="user">`:

```tsx
// client/src/App.tsx:855
<MotionConfig reducedMotion="user">
  <ThemeProvider>
    ...
  </ThemeProvider>
</MotionConfig>
```

This delegates to the operating system's `prefers-reduced-motion` setting, causing all framer-motion animations to instantly resolve without motion when the user has requested reduced motion. **DEFECT-0039 confirmed fixed.**

### CSS Animation Overrides
**Verdict: PASS**

A comprehensive `@media (prefers-reduced-motion: reduce)` block disables all CSS animations:

```css
/* client/src/index.css:941 */
@media (prefers-reduced-motion: reduce) {
  .sidebar-spring, .content-spring, .page-enter,
  .toast-enter, .popover-spring, .sub-items-reveal,
  .command-spring, .skeleton-shimmer, .badge-pulse,
  .liquid-glass::after, .liquid-glass-sm::after,
  .liquid-glass-subtle::after, .glass-panel::after {
    animation: none !important;
    transition: none !important;
    opacity: 1 !important;
  }
}
```

This covers all custom keyframe animations and glass-effect pseudo-elements. The `button` component's `active:scale-[0.96]` is a CSS transition that will also be suppressed by `transition: none !important` when it applies.

---

## Area 5: Form Accessibility

### Label Association
**Verdict: PASS**

The `FormControl` component (via Radix Slot) automatically injects `id`, `aria-describedby`, and `aria-invalid` onto the child input:

```tsx
// client/src/components/ui/form.tsx:114-125
<Slot
  ref={ref}
  id={formItemId}
  aria-describedby={
    !error
      ? `${formDescriptionId}`
      : `${formDescriptionId} ${formMessageId}`
  }
  aria-invalid={!!error}
  {...props}
/>
```

`FormLabel` uses `htmlFor={formItemId}` to associate with the control. Both `FormDescription` and `FormMessage` receive deterministic IDs for `aria-describedby` linkage.

### Error Announcements
**Verdict: PASS**

Form errors use `role="alert"` and `aria-live="polite"` for screen reader announcement:

```tsx
// client/src/components/ui/form.tsx:163-164
role="alert"
aria-live="polite"
```

An `AlertCircle` icon is included for visual identification of errors alongside text.

### Fieldset/Legend Grouping
**Verdict: CONCERN**

No `<fieldset>` or `<legend>` elements were found anywhere in the codebase. Multi-field form sections (e.g., address groups, contact information, property details in the settings page) use `<div>` wrappers with visual headings but lack the semantic `<fieldset>` grouping that screen readers use to announce field groups. This is a WCAG 1.3.1 (Info and Relationships) gap.

**Recommendation**: Wrap related form field clusters in `<fieldset>` with a `<legend>` element, particularly for:
- Address fields (street, city, state, zip)
- Contact information (name, email, phone)
- Settings sections with multiple related toggles

---

## Area 6: Image Alt Text

**Verdict: PASS**

All `<img>` tags found in the codebase include descriptive `alt` attributes:

| File | Alt Text |
|------|----------|
| `settings.tsx:1675` | `"2FA QR Code"` |
| `founder-dashboard.tsx:5591` | `{img.styleLabel}` (dynamic) |
| `reseller-dashboard.tsx:463` | `"Logo preview"` |
| `content-generation.tsx:110` | `` `Property photo ${i + 1}` `` |
| `quick-capture-fab.tsx:113` | `"Captured"` |
| `field-scanner.tsx:308` | `{DIRECTIONS[i]}` (dynamic) |
| `property-map.tsx:3249` | `"Property satellite view"` |
| `property-map.tsx:3277` | `"Property boundary map"` |
| `signature-capture.tsx:347` | `` `Signature of ${signerName}` `` (dynamic) |

A negative grep for `<img` without `alt` returned zero matches, confirming all images have alt text.

---

## Area 7: Heading Hierarchy

**Verdict: PASS (with minor note)**

Pages consistently use `<h1>` for the page title and `<h2>` for section headings. Example from the Today page:

```tsx
// client/src/pages/today.tsx
<h1 className="text-2xl md:text-3xl font-bold">  // Page title
<h2 className="text-lg font-semibold">Start Here Today</h2>
<h2 className="text-lg font-semibold">Today's Actions</h2>
<h2 className="text-lg font-semibold">Portfolio Alerts</h2>
<h2 className="text-lg font-semibold">Pax Noticed</h2>
// etc.
```

Property detail pages use `<h3>` and `<h4>` for nested sections appropriately. The `AlertTitle` component renders as `<h5>` which is semantically reasonable for alert-level headings within content.

**Minor note**: Some pages like the properties detail view use `<h4>` extensively for section titles (e.g., "Investment Scores", "Flood & Water Risk", "Natural Hazards") which could be elevated to `<h3>` for better semantic hierarchy. This is a best-practice refinement, not a failure.

---

## Area 8: Focus Indicators

**Verdict: PASS**

A global focus-visible style is applied at two layers:

### Layer 1: CSS custom focus rings (index.css:448-451)
```css
*:focus-visible {
  @apply outline-none ring-2 ring-primary/40 ring-offset-2 ring-offset-background;
}
```

### Layer 2: Element-specific enhanced focus (index.css:760-769)
```css
button:focus-visible,
a:focus-visible,
input:focus-visible,
select:focus-visible,
textarea:focus-visible,
[role="button"]:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px hsl(var(--background)),
              0 0 0 4px hsl(var(--primary) / 0.5);
}
```

This two-ring approach (inner ring matches background, outer ring uses primary color at 50% opacity) provides a visible 2px focus indicator that works in both light and dark modes. The `ring-offset-background` ensures the ring is visible against any background.

Additionally, every UI primitive includes its own `focus-visible` styles:
- **Button**: `focus-visible:ring-1 focus-visible:ring-ring`
- **Input**: `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`
- **Checkbox**: `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`
- **Switch**: `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`
- **Slider Thumb**: `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`
- **Radio**: `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`
- **Tabs Trigger**: `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`

---

## Area 9: Touch Targets

**Verdict: CONCERN**

### Standard Buttons
Default and large button variants meet the 44px minimum:
- `default` size: `min-h-9` (36px) + `py-2` (8px padding) = 36px height. This is below 44px but the interactive area with padding reaches adequate size.
- `lg` size: `min-h-10` (40px) + `px-8` = close to minimum.

### Icon Buttons
The `icon` variant is `h-9 w-9` (36x36px), which is **below the WCAG 2.5.5 AAA target of 44x44px** and also below the AA recommendation of 24x24px minimum with sufficient spacing. At 36px the buttons meet the minimum 24x24px but are borderline for comfortable mobile use.

```tsx
// client/src/components/ui/button.tsx:28
icon: "h-9 w-9 rounded-lg",
```

Many icon buttons in the Pax Copilot rail use an even smaller `className="h-7 w-7"` override (28x28px):

```tsx
// client/src/components/pax-copilot-rail.tsx:1060
<Button variant="ghost" size="icon" className="h-7 w-7" ...>
```

The CarouselPrevious/CarouselNext buttons are `h-8 w-8` (32x32px).

**Recommendation**: Consider increasing the `icon` variant to `h-10 w-10` (40px) or `h-11 w-11` (44px) for mobile, or adding a responsive modifier `md:h-9 md:w-9 h-10 w-10` to size up on touch devices.

---

## Area 10: Dynamic Content & Live Regions

**Verdict: PASS**

### Toast Notifications
The `ToastViewport` includes both `aria-live="polite"` and `aria-label="Notifications"`:

```tsx
// client/src/components/ui/toaster.tsx:30
<ToastViewport aria-live="polite" aria-label="Notifications" />
```

### Dynamic Island
The Dynamic Island (floating notification at top of screen) uses `aria-live="polite"` and `aria-atomic="true"`:

```tsx
// client/src/components/dynamic-island.tsx:87-88
aria-live="polite"
aria-atomic="true"
```

### Cookie Consent Banner
```tsx
// client/src/components/cookie-consent-banner.tsx:42-44
role="dialog"
aria-label="Cookie consent"
aria-live="polite"
```

### Form Validation Messages
```tsx
// client/src/components/ui/form.tsx:163-164
role="alert"
aria-live="polite"
```

### Missing: aria-busy for Loading States
**Sub-verdict: CONCERN**

There are 377 instances of `Loader2 ... animate-spin` across 135 files, but zero uses of `aria-busy="true"` anywhere in the codebase. When content regions are loading (showing skeletons or spinners), screen readers have no way to know that content is still being fetched.

**Recommendation**: Add `aria-busy="true"` to container elements during loading states, particularly on data tables, page content areas, and any region displaying skeleton placeholders.

---

## Area 11: Viewport and Zoom (DEFECT-0040)

**Verdict: PASS**

The viewport meta tag does not restrict zoom:

```html
<!-- client/index.html:4 -->
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
```

No `maximum-scale` or `user-scalable=no` restrictions are present. Users can zoom freely. **DEFECT-0040 confirmed fixed.**

---

## Area 12: Language and Document Structure

**Verdict: PASS**

```html
<!-- client/index.html:2 -->
<html lang="en">
```

The document language is set, satisfying WCAG 3.1.1.

---

## Previously Reported Defects -- Status

| Defect | Description | Status |
|--------|-------------|--------|
| DEFECT-0037 | Icon-only buttons missing `aria-label` | **FIXED** -- 208 aria-labels across 94 files, 0 unlabeled icon buttons |
| DEFECT-0038 | No skip-to-content link | **FIXED** -- Skip link at App.tsx:820, targets #main-content at line 758 |
| DEFECT-0039 | No `prefers-reduced-motion` support | **FIXED** -- MotionConfig at App.tsx:855 + CSS @media block at index.css:941 |
| DEFECT-0040 | Viewport restricts zoom | **FIXED** -- No zoom restrictions in viewport meta |

---

## New Findings Summary

| # | Area | Verdict | Description | WCAG SC | Severity |
|---|------|---------|-------------|---------|----------|
| 1 | Form grouping | CONCERN | No `<fieldset>`/`<legend>` for related form field groups | 1.3.1 | P2 |
| 2 | Touch targets | CONCERN | Icon buttons at 36x36px (some at 28x28px) below 44px recommendation | 2.5.5 | P2 |
| 3 | Loading states | CONCERN | No `aria-busy` on loading regions (377 spinner instances, 0 aria-busy) | 4.1.3 | P2 |
| 4 | Hardcoded colors | CONCERN | Visualization components use hex colors; yellow (#fbbf24) may fail 3:1 contrast on light backgrounds | 1.4.11 | P3 |

---

## Recommendations (Priority Order)

1. **Add `aria-busy`** to loading containers. When a `Skeleton` or `Loader2` is showing, the parent should have `aria-busy="true"` and switch to `false` on load complete.

2. **Increase icon button touch targets** on mobile. A responsive approach like `h-9 w-9 md:h-9 md:w-9` (desktop) and `h-11 w-11` (mobile) would satisfy WCAG 2.5.5.

3. **Add `<fieldset>`/`<legend>`** to multi-field form groups in settings, lead creation, deal creation, and property forms.

4. **Audit visualization colors** for 3:1 non-text contrast. Consider adding patterns or shapes in addition to color for map markers (WCAG 1.4.1 Use of Color).

---

## Strengths Worth Preserving

- **Radix UI primitives** provide excellent keyboard navigation, focus trapping, and ARIA attributes out of the box. Do not replace these with custom implementations.
- **Design token system** (HSL custom properties via Tailwind) ensures consistent contrast across themes. The 6-theme preset system (Desert, Midnight, Forest, Ocean, Sunset, Monochrome) all maintain proper foreground/background contrast.
- **Global focus-visible styles** with two-ring approach work in both light and dark modes.
- **MotionConfig with `reducedMotion="user"`** is the gold standard for motion sensitivity handling -- it respects OS-level preferences without requiring in-app toggles.
- **Comprehensive sr-only text** on icon-only controls throughout the component library.
