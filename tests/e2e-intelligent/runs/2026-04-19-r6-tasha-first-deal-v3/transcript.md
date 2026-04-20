# E2E Intelligent Test Transcript — r6 Tasha × First Deal Evaluation (v3, mobile)

- **Run ID**: 2026-04-19-r6-tasha-first-deal-v3
- **Persona**: 10-mobile-only-driving-for-dollars (Tasha Okonkwo)
- **Journey**: 01-first-deal-evaluation
- **Date**: 2026-04-20
- **Steps**: 4
- **Viewport**: 375 × 812 (iPhone 13-class)
- **Canonical URL**: https://acreos.io

## Persona Summary

Tasha Okonkwo, 31, Savannah GA, 1 year investing. DealMachine alum applying driving-for-dollars to vacant land. Mobile-only, medium tech comfort, uses the app in bright sunlight with one hand. Needs: tap-a-location-on-map-to-get-parcel-data, owner lookup on mobile, photo attachment, GPS integration.

## Journey Objective

From her phone, in the field: locate a parcel (via map tap or address search), pull up owner/assessment data, decide to pursue or pass, attach a photo from her camera.

---

## Steps

### Step 1 — Sign in via ticket → /today at mobile viewport

- **URL**: ticket → /today (9s redirect)
- **Observed**: Mobile layout is responsive. Sidebar collapsed to a top nav bar: Today / Pipeline / Money / AI Hub / More. No tablet-wide sidebar visible — good. The same dashboard content renders (Getting Started, AI Action Queue, Portfolio Overview).
- **In-character thought**: _"Okay, the app actually laid itself out for my phone. Top nav with five items plus More. That's cleaner than the full sidebar would have been. Let me find the map — I'm planning to drive Cochise this weekend and I want to see if any parcels pop up near my route."_
- **UX-R6-001 inherited**: Portfolio Overview still shows "Properties: 0 / 0 own" despite the inventory containing 2 parcels — same counter bug as r1.

### Step 2 — Navigate to /maps (Portfolio Map)

- **URL**: /maps
- **Observed**: Page title: "Property Intelligence Map / 0/0 / Properties / Deals / No properties with coordinates / Add GPS coordinates to your properties to visualize them on the 3D intelligence map with parcel boundaries, terrain analysis, and demand heatmaps. / Go to Inventory"
- **DOM check**: no `<canvas>`, no Leaflet, no Mapbox DOM elements — no actual map tile renderer is present. The page shows an empty-state card in place of a map.
- **Structural finding**: STR-R6-001 HIGH — /maps is not a map. It renders an empty state saying "No properties with coordinates" instead of a basemap. For a driving-for-dollars persona, a map without tiles is the feature not existing. The two properties in this org (Yavapai AZ, Cochise AZ) both have county + state fields but apparently no `latitude`/`longitude` stored, so they don't plot.
- **In-character thought**: _"Well. The Portfolio Map is... empty. Not just 'no parcels to show' — there's literally no map underneath. Just a card telling me to add GPS coordinates to my properties first. In DealMachine I open the map, it centers on my current location, I tap a house, I get the owner. Here I'd have to manually add coordinates to every property before I even see a basemap. That's the opposite of driving-for-dollars."_

### Step 3 — Look for current-location / tap-to-add affordance

- **URL**: /maps
- **Observed**: No "use current location" button, no "add parcel here" on-map affordance, no pin drop, no camera capture button on this page. The only CTA is "Go to Inventory" which goes back to the property list.
- **Workflow finding**: WF-R6-001 HIGH — Mobile flow for Tasha's driving-for-dollars use case is absent. From /maps there is no path to: (a) see where I am, (b) tap a location, (c) fetch parcel data for that location, (d) attach a photo.
- **In-character thought**: _"If I drive out to Cochise this Saturday, AcreOS can't tell me what parcel I'm standing on. I'd need to look up the APN by hand on the county assessor site, then type it into AcreOS, then upload a photo through some separate flow. That's three apps. I might as well use DealMachine for the driving part and just export leads to AcreOS later."_

### Step 4 — Abandon: core mobile workflow not present

- **URL**: /maps
- **Action**: `abandon: no mobile field-tooling for driving-for-dollars`
- **In-character thought**: _"I'll bookmark this and check back in six months. The desktop side might be fine for managing the CRM once I have leads, but for the 'find deals from my car' part of my process this isn't ready. Tapping 'Start Trial' right now would be trial money wasted."_

---

## Journey Verdict

- **Outcome**: **ABANDONED**
- **Satisfaction**: 1/5
- **Would Recommend**: no
- **Reasoning**: The mobile-persona-core affordance (tap map → get parcel data) is not present. Tasha's abandonment triggers #2 (parcel boundaries missing) and #4 (touch targets / map doesn't work on cellular) are both structurally met by the same root cause: `/maps` has no map tile renderer, only an empty state. The first-deal-evaluation journey's /analyze step was not reached because Tasha would not get past /maps on her own workflow. ABANDONED, not BLOCKED, because the product is not defective — it's just not built for her. The cycle-3 /analyze regression from r1 is independent.

### Top Issues

- `/maps` does not render a map on mobile (no tile canvas, no Leaflet/Mapbox DOM) — the empty state replaces the map even when the user has properties, and no tap-to-add or current-location affordance exists (STR-R6-001 HIGH + WF-R6-001 HIGH).
- Portfolio Overview on /today shows Properties: 0 despite 2 in Inventory (same as r1 UX-001).
- No visible photo-attach workflow from mobile for a parcel.
