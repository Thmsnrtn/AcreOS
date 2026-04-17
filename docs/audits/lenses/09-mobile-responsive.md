# Lens 09 -- Mobile & Responsive Design Audit

**Auditor persona:** Mobile and responsive design specialist
**Date:** 2026-04-15
**Scope:** Client-side code -- Tailwind breakpoints, touch targets, mobile navigation, PWA manifest/SW, viewport, and key pages (today, leads, deals, founder-dashboard, maps)

---

## Executive Summary

AcreOS has meaningful mobile infrastructure: a bottom navigation bar, a Sheet-based sidebar drawer, mobile card views for leads and deals, proper safe-area insets, and a complete PWA manifest with offline-capable service worker. Touch target sizing in the CRM pages (leads, deals) is deliberately enforced at 44px. However, several pages lack responsive breakpoints (the maps intelligence panel hard-codes a 320px side panel that overlays the map on narrow screens), the Today page uses `grid-cols-3` without a small-screen fallback, the founder dashboard tab strip has undersized touch targets, the viewport meta tag blocks pinch-to-zoom (an accessibility concern), and two fixed-position toolbars (MobileBottomNav and FieldWorkToolbar) both claim `bottom-0 z-50` with no mutual exclusion, creating potential z-fighting. The 30-font Google Fonts request in `index.html` is a severe mobile performance penalty on 3G/4G connections.

---

## Findings

### MOB-01: Viewport meta blocks user zoom
| Field | Value |
|-------|-------|
| **Severity** | P1 |
| **File** | `client/index.html:5` |
| **Evidence** | `<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1, user-scalable=no" />` |
| **Description** | `maximum-scale=1, user-scalable=no` prevents pinch-to-zoom. This is a WCAG 1.4.4 failure (resize text). Users with low vision rely on zoom. Some mobile browsers now ignore this, but Safari on iOS still honors it. |
| **Remediation** | Remove `maximum-scale=1` and `user-scalable=no`. If the concern is preventing double-tap zoom on forms, use `touch-action: manipulation` in CSS instead. |

### MOB-02: Missing `viewport-fit=cover` for notched devices
| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **File** | `client/index.html:5` |
| **Evidence** | Viewport meta does not include `viewport-fit=cover`. Safe-area env vars are used in the bottom nav (`env(safe-area-inset-bottom)`) and sidebar, but they have no effect without `viewport-fit=cover`. |
| **Description** | On iPhone models with a notch or Dynamic Island, content will be inset by the system rather than filling the full screen. The `safe-area-inset-*` env vars used in `MobileBottomNav.tsx:29` and `layout-sidebar.tsx:1025` only function when `viewport-fit=cover` is set. Without it, the bottom nav's safe-area padding is always 0px, and on notched devices the app may not fill the display properly in PWA standalone mode. |
| **Remediation** | Change viewport to: `width=device-width, initial-scale=1.0, viewport-fit=cover`. |

### MOB-03: Today page "Agent Activity" grid uses `grid-cols-3` without mobile fallback
| Field | Value |
|-------|-------|
| **Severity** | P1 |
| **File** | `client/src/pages/today.tsx:471` |
| **Evidence** | `<div className="grid grid-cols-3 gap-3">` -- three columns at all widths. On a 320px screen minus padding, each column is ~88px wide. Content inside includes "Active Agents", "Pending Approvals", "Autonomy Score" with text and numbers. |
| **Description** | At 320px viewport (iPhone SE, older Androids), each cell is cramped. The "Pending Approvals" and "Autonomy Score" labels truncate or overflow. There is no `sm:grid-cols-3` breakpoint, meaning 3 columns is forced even at the narrowest supported width. |
| **Remediation** | Change to `grid-cols-1 sm:grid-cols-3` or `grid-cols-2 sm:grid-cols-3` to stack on very narrow screens. |

### MOB-04: Today page "Cash Position" grid uses `grid-cols-3` at all widths
| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **File** | `client/src/pages/today.tsx:1010` |
| **Evidence** | `<div className="grid grid-cols-3 gap-2">` for cash position breakdown (30/60/90 day projections). |
| **Description** | Same issue as MOB-03. On narrow devices, three monetary columns compress labels. Less critical than agent activity since the content is shorter. |
| **Remediation** | Use `grid-cols-1 sm:grid-cols-3`. |

### MOB-05: Maps page -- PropertyIntelligencePanel hardcodes `w-80` (320px) with no mobile adaptation
| Field | Value |
|-------|-------|
| **Severity** | P0 |
| **File** | `client/src/pages/maps.tsx:292` |
| **Evidence** | `<div className="w-80 border-l bg-card overflow-y-auto flex-shrink-0 flex flex-col" style={{ maxHeight: "calc(100vh - 130px)" }}>` |
| **Description** | When a property is selected on mobile, the intelligence panel renders at a fixed 320px width next to the map in a flex row (`<div className="flex" style={{ height: "calc(100vh - 125px)" }}>`). On a 375px phone screen, the map area collapses to ~55px. The panel does not adapt to a drawer/sheet on mobile. The map becomes functionally unusable when a property is selected. |
| **Remediation** | On mobile (below `md`), render the panel as a bottom Sheet/Drawer or full-screen overlay instead of a side panel. Use the existing `useIsMobile` hook. |

### MOB-06: Maps page -- Search and status filter hidden on mobile with no clear alternative
| Field | Value |
|-------|-------|
| **Severity** | P1 |
| **File** | `client/src/pages/maps.tsx:928, 944-945` |
| **Evidence** | Search: `className="relative w-44 hidden sm:block"`. Status filter: `className="w-32 h-7 text-xs hidden md:flex"`. |
| **Description** | On phones, the search input and status dropdown are hidden. The search is available inside the Filters sheet (`sm:hidden` block at line 974), but the user must open the sheet to search. The status filter is also in the sheet but users may not discover it. There is no visual indication that search/filter is available. |
| **Remediation** | Add a visible search icon or compact search bar in the mobile header. Consider making the filter button more prominent with a badge indicating active filter count. |

### MOB-07: Maps page height calculation does not account for bottom navigation
| Field | Value |
|-------|-------|
| **Severity** | P1 |
| **File** | `client/src/pages/maps.tsx:1052` |
| **Evidence** | `style={{ height: "calc(100vh - 125px)" }}` |
| **Description** | The map container uses a fixed viewport height minus 125px for the header. On mobile, the MobileBottomNav adds 72px at the bottom. The map extends behind the bottom nav, clipping map controls and making the bottom ~72px of the map uninteractable. The page also uses negative margins `-mx-4 -my-8` to go full-bleed. |
| **Remediation** | On mobile, reduce height to `calc(100vh - 125px - 72px)` or use `100dvh` with proper bottom insets. Better yet, detect `isMobile` and adjust dynamically. |

### MOB-08: Founder dashboard tab buttons have undersized touch targets
| Field | Value |
|-------|-------|
| **Severity** | P1 |
| **File** | `client/src/pages/founder-dashboard.tsx:1965-1979` |
| **Evidence** | Tab buttons: `className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors"`. The resulting height is approximately 36-38px (py-2.5 = 10px top+bottom + ~16px text + icon). |
| **Description** | The five dashboard tabs (Overview, Agents & AI, Operations, Growth, Infrastructure) are below the 44px minimum touch target. They are horizontally scrollable via `overflow-x-auto`, which is good, but the vertical tap area is too small for comfortable mobile use. The same issue exists in the sticky sub-navigation at line 6442 with `px-3 py-1.5` buttons (~28px height). |
| **Remediation** | Increase `py-2.5` to `py-3` or add `min-h-[44px]` to tab buttons. For the sub-nav, increase `py-1.5` to `py-2.5` or add explicit min-height. |

### MOB-09: Today page alert dismiss buttons are 28px (h-7 w-7)
| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **File** | `client/src/pages/today.tsx:725` |
| **Evidence** | `className="h-7 w-7"` on the dismiss (X) button for system alerts, and adjacent "View" button `className="text-xs h-7"`. |
| **Description** | At h-7 (28px), these interactive buttons are well below the 44px minimum. Adjacent placement of two small buttons ("View Notes" + "X") makes mis-taps likely on mobile. |
| **Remediation** | Increase to `min-h-[44px] min-w-[44px]` on mobile, or use the pattern already established in leads.tsx. |

### MOB-10: SidebarTrigger (ui/sidebar.tsx) defaults to `h-7 w-7` (28px)
| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **File** | `client/src/components/ui/sidebar.tsx:269` |
| **Evidence** | `className={cn("h-7 w-7", className)}` |
| **Description** | The shadcn sidebar trigger button is 28px. While the custom layout-sidebar.tsx overrides this with `min-h-[44px] min-w-[44px]` for the mobile hamburger (line 1032), any page that uses the standard `SidebarTrigger` component directly would get the undersized default. |
| **Remediation** | Change default to `h-8 w-8` or `min-h-[44px] min-w-[44px]` on mobile. |

### MOB-11: Two fixed bottom toolbars can render simultaneously
| Field | Value |
|-------|-------|
| **Severity** | P1 |
| **File** | `client/src/components/mobile/MobileBottomNav.tsx:28`, `client/src/components/field-work-toolbar.tsx:25` |
| **Evidence** | Both use `fixed bottom-0 left-0 right-0 z-50`. MobileBottomNav renders when `isMobile && !isKeyboardOpen`. FieldWorkToolbar renders when `isMobile || isCapacitor`. |
| **Description** | If both conditions are met (mobile device, not in keyboard state), both toolbars render at the same position with the same z-index. They will overlap, making both unusable. The FieldWorkToolbar does not check whether MobileBottomNav is visible. |
| **Remediation** | Either conditionally render only one toolbar, or offset FieldWorkToolbar above the bottom nav (e.g., `bottom-[72px]`). Consider merging into a single mobile toolbar. |

### MOB-12: Massive Google Fonts request blocks first paint on mobile
| Field | Value |
|-------|-------|
| **Severity** | P1 |
| **File** | `client/index.html:28` |
| **Evidence** | A single `<link>` tag loads 30 font families from Google Fonts (DM Sans, Fira Code, Geist, Geist Mono, IBM Plex Mono, IBM Plex Sans, Inter, JetBrains Mono, Libre Baskerville, Lora, Merriweather, Montserrat, Open Sans, Outfit, Oxanium, Playfair Display, Plus Jakarta Sans, Poppins, Roboto, Roboto Mono, Source Code Pro, Source Serif 4, Space Grotesk, Space Mono, Architects Daughter). |
| **Description** | On a 3G connection (~750kbps), this request can add 3-8 seconds to first paint. The CSS file itself may be 100KB+, and the actual font files downloaded vary but can total 1-3MB. Most of these fonts appear unused or used only in theme previews. This is render-blocking for text content. |
| **Remediation** | Load only the 1-2 fonts actually used (likely Inter or Plus Jakarta Sans for body, one mono font for code). Move the rest to async loading or load on demand for theme preview only. Use `font-display: swap` if not already set by Google Fonts. |

### MOB-13: PWA manifest missing `id` field
| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **File** | `client/public/manifest.json` |
| **Evidence** | The manifest has `start_url: "/"` but no `id` field. |
| **Description** | The `id` field uniquely identifies the PWA. Without it, browsers use `start_url` as the identity, which can cause issues if the start URL ever changes. Chrome DevTools also warns about this. |
| **Remediation** | Add `"id": "/"` or a more specific identifier like `"id": "acreos-pwa"`. |

### MOB-14: Service worker `online` event listener on wrong scope
| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **File** | `client/public/sw.js:156-158` |
| **Evidence** | `self.addEventListener('online', () => { replayOfflineQueue()... });` |
| **Description** | The `online` event does not fire on the `ServiceWorkerGlobalScope` (`self`). It fires on `window` in the main thread. The offline replay queue will never automatically replay when the device comes back online. The background sync API (`sync` event) should be used instead. |
| **Remediation** | Replace with `self.addEventListener('sync', ...)` using the Background Sync API, or trigger replay from the main thread via `navigator.onLine` / `window.addEventListener('online')` and communicate to the SW via `postMessage`. |

### MOB-15: Leads page FocusList sidebar does not collapse on mobile
| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **File** | `client/src/pages/leads.tsx:1712` |
| **Evidence** | `<div className="lg:w-80 flex-shrink-0"><FocusList /></div>` |
| **Description** | The FocusList panel has `lg:w-80` but no `hidden` class below `lg`. On tablet-sized screens (md to lg), it renders as a full-width block below the table, pushing content down. On actual phones it renders as full-width. While not broken, this is a large block of supplementary content that takes up valuable mobile screen real estate. |
| **Remediation** | Add `hidden lg:block` to hide on mobile/tablet, or render as a collapsible section. |

### MOB-16: Floating elements (FAB, assistant, feedback widget) stack in bottom-right on mobile
| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **File** | Multiple components |
| **Evidence** | `floating-action-button.tsx:102` (bottom-4 right-4), `beta-feedback-widget.tsx:35` (bottom-4 right-4), `floating-help-button.tsx:33` (bottom-6 right-6), `conversation-tray.tsx:570` (bottom-6 right-6), `quick-capture-fab.tsx:74` (bottom-20 right-4), `floating-assistant.tsx:1005` (bottom-20 right-4). |
| **Description** | Multiple floating buttons can render simultaneously in the bottom-right corner. While some use `bottom-20` to account for the bottom nav, the beta-feedback-widget and floating-help-button use `bottom-4`/`bottom-6` and will overlap with or be hidden behind the MobileBottomNav (72px tall). There is no coordination layer for these overlapping elements. |
| **Remediation** | Implement a floating element manager or portal that staggers elements vertically. Ensure all floating elements on mobile use `bottom-20` or higher to clear the bottom nav. |

### MOB-17: Founder dashboard is a 7286-line single page with no code splitting by tab
| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **File** | `client/src/pages/founder-dashboard.tsx` |
| **Evidence** | 7286 lines, 382KB JS chunk (per orientation doc), 5 tabs each with many sub-components. |
| **Description** | On mobile with limited bandwidth and CPU, parsing this chunk is slow. Only one tab is visible at a time, yet all tab content is loaded. The orientation doc notes this as a 382KB chunk. On a mid-range phone, parsing alone can take 1-2 seconds. |
| **Remediation** | Lazy-load each tab's content with `React.lazy` and `Suspense`. Several components are already imported with `lazy()` (line 110), so extend this pattern to all tab contents. |

---

## Embarrassment Test

> "If a real estate investor opened AcreOS on their iPhone at a property showing, would anything embarrass us?"

**Yes.** Selecting a property on the Maps page causes the intelligence panel to consume the entire screen width, collapsing the map to an unusable sliver. The investor cannot see the map and the property details simultaneously. They would need to close the panel, look at the map, memorize what they see, then reopen the panel. On competitor apps (Zillow, LandGlide), side panels become bottom sheets on mobile. This is the single most embarrassing mobile moment.

The 30-font Google Fonts load means first paint on cellular may show a blank white screen for 3-5 seconds while fonts download. A prospect opening a shared link on their phone would see nothing.

---

## Pride Test

> "What mobile work would we confidently demo?"

1. **MobileBottomNav** -- Well-implemented iOS-style bottom tab bar with 4 customizable tabs + "More" drawer. Proper safe-area handling, 72px height, keyboard dismissal, active state indicators.
2. **Leads mobile card view** -- Full card layout with proper touch targets (44px), select-all, sort, dropdown actions. Clean visual hierarchy.
3. **Deals mobile Kanban** -- Thoughtful mobile adaptation with stage selector (prev/next buttons), list view toggle, all controls at 44px minimum. One of the better mobile implementations.
4. **PWA service worker** -- Comprehensive offline support with IndexedDB queue for mutations, background sync replay, push notifications, cache-first strategy. Well-structured.
5. **Mobile sidebar drawer** -- Sheet-based navigation with 85vw/320px max, proper safe-area classes, full nav tree, min-h-[44px] on interactive items.
6. **MobileCommandDrawer** -- Slick command palette for mobile with search, quick actions in a grid, and Drawer component. Good touch of a native-feeling experience.
