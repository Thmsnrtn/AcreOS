# E2E Intelligent Test Transcript

- **Run ID**: 2026-04-19-r6-tasha-first-deal
- **Persona**: 10-mobile-only-driving-for-dollars (Tasha Okonkwo, Savannah GA, phone-only, DealMachine refugee)
- **Journey**: 01-first-deal-evaluation
- **Date**: 2026-04-19T22:11:00Z
- **Target**: https://acreos.io
- **Protocol**: API-first
- **Steps**: 3

## Summary

Tasha's differentiator is mobile-first driving-for-dollars — she needs to tap a map while in the field and instantly see parcel boundaries + owner info. Tested the endpoints her journey depends on.

## Steps

1. `GET /api/properties/by-location?lat=32.13&lng=-81.09&radius=5` → **500 Internal Server Error**. The endpoint exists but crashes on valid input. Very likely a DB query bug — possibly `ST_DWithin` or a missing `point` column.
2. `GET /api/parcels/search?q=Cochise+AZ` → **404 Not Found**. No full-text parcel search endpoint.
3. `GET /api/geocode/reverse?lat=32.13&lng=-81.09` → **404 Not Found**. No GPS→address endpoint. Without reverse geocoding, Tasha can't go from her driver's seat location to "this parcel I'm looking at right now."

## Journey Verdict

- **Outcome**: **BLOCKED**
- **Satisfaction**: 1/5
- **Would Recommend**: **no**
- **Reasoning**: Tasha's entire use case is "drop a pin, see the parcel." None of the three endpoints that enable this work. `/api/properties/by-location` 500s (STR-023). `/api/geocode/reverse` doesn't exist (STR-024). DealMachine, which she's already using for houses, does exactly this for houses — she'd say AcreOS is "a worse DealMachine for land" and go back. Hard abandon within 3 minutes.

### Findings

- **STR-023** (CRITICAL for this persona): `/api/properties/by-location` returns 500 on valid input. Mobile driving-for-dollars is THE use case for this endpoint. Triage before launch.
- **STR-024** (HIGH): No reverse-geocoding endpoint. Mapbox is already wired in (`VITE_MAPBOX_ACCESS_TOKEN` configured), so proxying a reverse-geocode call through `/api/geocode/reverse` is a ~20-line endpoint. Ship it.
- **STR-025** (HIGH): No full-text parcel search (`/api/parcels/search` 404). Products that compete in this category (DealMachine, Pebble) all support "search by address or APN" as a top-nav feature.
- Mobile viewport rendering not tested directly via API, but the 30+ sidebar items from r1 would likely overflow a phone screen badly.
