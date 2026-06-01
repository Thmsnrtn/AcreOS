/**
 * founder-dashboard.tsx — DELETED (Phase Zero-Zero declutter, 2026-06-01)
 *
 * This was a 5,861-line monolith. Per the extraction plan at
 * docs/exhaustive-completion/founder-dashboard-extraction-queue.md,
 * the meaningful sub-surfaces have been extracted to dedicated routes:
 *
 *   /founder            → client/src/pages/founder/index.tsx (Pulse)
 *   /founder/cost       → client/src/pages/founder/cost.tsx (Cost — new)
 *   /founder/customers  → client/src/pages/founder/customers.tsx
 *   /founder/keys       → client/src/pages/founder/keys.tsx
 *   /founder/readiness  → client/src/pages/founder/readiness.tsx
 *   /founder/customers/health → client/src/pages/founder/customers/health.tsx
 *   /founder/growth/campaigns → client/src/pages/founder/growth/campaigns.tsx
 *
 * The /founder-dashboard route in App.tsx redirects to /founder/bridge.
 *
 * Sub-components that were self-contained inside this file and had no
 * external callers (NewSubscriberFeed, AIModelsSection, FeatureFlagsSection,
 * PricingSection, etc.) have been dropped — all of that functionality is
 * reachable via the dedicated routes above or via the Deep Tools overflow
 * in the founder sidebar.
 *
 * TODO(declutter): The .DELETED.bak file remains on disk for one release
 * window for safety. Delete it after confirming no regression in production.
 *
 * The actual backup is at: client/src/pages/founder-dashboard.DELETED.bak
 */

// This file intentionally exports nothing — the route redirects in App.tsx.
export {};
