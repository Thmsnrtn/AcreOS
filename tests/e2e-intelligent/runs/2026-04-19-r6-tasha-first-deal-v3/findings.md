# Findings Report — r6 Tasha × First Deal Evaluation (mobile)

- **Run ID**: 2026-04-19-r6-tasha-first-deal-v3
- **Persona**: 10-mobile-only-driving-for-dollars (Tasha Okonkwo)
- **Journey**: 01-first-deal-evaluation
- **Viewport**: 375 × 812
- **Total Findings**: 2

## HIGH

### STR-R6-001: /maps renders no map on mobile; only an empty-state card

- **Severity**: HIGH
- **Category**: structural (UX overlap)
- **Step**: 2
- **URL**: https://acreos.io/maps
- **Description**: Navigation to /maps at mobile viewport 375 × 812 loads a page with the heading "Property Intelligence Map" and an empty-state message "No properties with coordinates / Add GPS coordinates to your properties to visualize them on the 3D intelligence map…". The DOM contains no `<canvas>`, no Leaflet or Mapbox tile layer. A basemap is not rendered regardless of whether the org has properties.
- **Evidence**: `document.querySelector('[class*="leaflet"], [class*="mapboxgl"], canvas')` returned null. Body text confirms the "0/0 Properties / Deals" counter and "No properties with coordinates" copy.
- **Persona Impact**: Kills the driving-for-dollars workflow outright. Tasha cannot tap a location to identify the parcel she's standing next to.
- **Recommended Action**: Render a base tile layer (Mapbox or Leaflet OSM) on /maps by default, with a geolocation "center on me" control. The empty state should overlay on top of the tiles rather than replace them. Also: auto-geocode a property's `city, state` fields to a lat/lng when explicit coordinates are missing, so the two existing properties plot immediately.

### WF-R6-001: No mobile tap-to-add-parcel or photo-capture workflow

- **Severity**: HIGH
- **Category**: workflow
- **Step**: 3
- **URL**: https://acreos.io/maps (and /properties on mobile)
- **Description**: The driving-for-dollars mobile workflow — while in the field, tap the map at the current location, AcreOS looks up the parcel and pulls owner + assessment data, attach a camera-captured photo to the lead — has no visible entry point. /maps offers only "Go to Inventory" as a CTA, and /properties's "Add Property" dialog is a manual form.
- **Evidence**: DOM walk found no button labeled or aria-labelled "use current location," "tap to add parcel," "drop pin," or "add photo" on the mobile /maps route.
- **Persona Impact**: Tasha's core work cannot happen on AcreOS. She would continue to use DealMachine for field capture and at best use AcreOS as an upstream CRM that receives exported leads.
- **Recommended Action**: Add a mobile-first capture flow: geolocate → reverse-geocode → lookup parcel via Regrid/BatchData → render a "Add to leads" card with a camera CTA. The building blocks exist (see `/api/geocode/reverse` verified in cycle 2) but the mobile UI tying them together does not.
